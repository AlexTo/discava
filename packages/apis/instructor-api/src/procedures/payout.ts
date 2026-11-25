/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import {
  isConnectNotAllowed,
  isInvalidRequest,
  isResourceMissing,
  mapAccountStatus,
  PaymentAccountMismatchError,
  type PayoutStripe,
  payoutStripe,
} from '@discava/common-server-utils/stripe/payouts';
import { PaymentsNotConnectedError } from '@discava/common-server-utils/stripe/secrets';
import {
  getConnection,
  openEntries,
  type PayoutAccountRecord,
  type PayoutRecord,
  saveAccountStatus,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  type IPayoutOverviewOutput,
  PayoutAccountOutputSchema,
  PayoutLinkOutputSchema,
  PayoutOverviewOutputSchema,
  StartOnboardingInputSchema,
} from '../schema/index.js';

// The caller's own payout account, inside the current payment account (the
// `accountId` and `mode` of the payment connection, read on every call). The
// instructor is always `ctx.user.sub`; no input names one. Nothing here calls
// Stripe unless the connection is `active`.

const UNAVAILABLE = "Payouts aren't available yet";
const CONNECT_NOT_ENABLED = "This platform can't set up payout accounts yet";
const ACCOUNT_NOT_FOUND =
  "We can't find your payout account at Stripe. Please contact support";

type CoreTable = Parameters<typeof getConnection>[0];

interface PaymentAccount {
  accountId: string;
  mode: 'test' | 'live';
}

const currentPaymentAccount = async (
  coreTable: CoreTable,
): Promise<PaymentAccount | undefined> => {
  const connection = await getConnection(coreTable);
  return connection?.status === 'active' && connection.accountId
    ? { accountId: connection.accountId, mode: connection.mode }
    : undefined;
};

const requirePaymentAccount = async (coreTable: CoreTable) => {
  const account = await currentPaymentAccount(coreTable);
  if (!account) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: UNAVAILABLE });
  }
  return account;
};

// A saved key that is gone, or is another account's, means payouts can't be
// set up for the current payment account.
const stripeFor = async (account: PaymentAccount): Promise<PayoutStripe> => {
  try {
    return await payoutStripe(account);
  } catch (error) {
    if (
      error instanceof PaymentsNotConnectedError ||
      error instanceof PaymentAccountMismatchError
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: UNAVAILABLE,
      });
    }
    throw error;
  }
};

const storedAccount = async (
  coreTable: CoreTable,
  instructorId: string,
  { accountId, mode }: PaymentAccount,
) =>
  (
    await coreTable.entities.payoutAccount
      .get({ instructorId, accountId, mode })
      .go()
  ).data as PayoutAccountRecord | null;

// A path on the portal, never another site: it starts with one slash and
// still parses as a path of the same origin.
const validReturnPath = (path: string): boolean => {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return false;
  }
  try {
    return (
      new URL(path, 'http://portal.invalid').origin === 'http://portal.invalid'
    );
  } catch {
    return false;
  }
};

export const account = courseProcedure
  .output(PayoutAccountOutputSchema)
  .query(async ({ ctx }) => {
    const { coreTable } = ctx;
    const instructorId = ctx.user.sub;
    const payment = await currentPaymentAccount(coreTable);
    if (!payment) return { status: 'unavailable' as const };

    const stored = await storedAccount(coreTable, instructorId, payment);
    if (!stored) return { status: 'not_started' as const };

    try {
      const stripe = await payoutStripe(payment);
      const status = mapAccountStatus(
        await stripe.retrieveAccount(stored.connectedAccountId),
      );
      if (status !== stored.status) {
        await saveAccountStatus({ coreTable, ...stored, status });
      }
      return { status };
    } catch (error) {
      // The page should still show what we last knew.
      ctx.logger?.warn?.('Could not refresh the payout account from Stripe', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return { status: stored.status, stale: true };
    }
  });

export const startOnboarding = courseProcedure
  .input(StartOnboardingInputSchema)
  .output(PayoutLinkOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const instructorId = ctx.user.sub;
    const payment = await requirePaymentAccount(coreTable);

    const origin = getAllowedOrigin(ctx.event);
    if (!origin || !validReturnPath(input.returnPath)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Return to a page of the instructor portal',
      });
    }
    const returnUrl = `${origin}${input.returnPath}`;

    const stripe = await stripeFor(payment);
    try {
      let stored = await storedAccount(coreTable, instructorId, payment);
      if (!stored) {
        // Stripe's create is idempotent by key, so concurrent first calls get
        // the same account; the conditional create keeps one record.
        const created = await stripe.createExpressAccount(instructorId);
        stored = await saveAccountStatus({
          coreTable,
          instructorId,
          accountId: payment.accountId,
          mode: payment.mode,
          connectedAccountId: created.id,
          status: mapAccountStatus(created),
        });
      }
      const link = await stripe.createAccountLink({
        connectedAccountId: stored.connectedAccountId,
        returnUrl,
        refreshUrl: returnUrl,
      });
      return { url: link.url };
    } catch (error) {
      if (isConnectNotAllowed(error)) {
        ctx.logger?.error?.(
          'Stripe refused to set up a payout account: the key lacks the permission or Connect is not enabled',
          { errorName: error instanceof Error ? error.name : 'unknown' },
        );
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: CONNECT_NOT_ENABLED,
        });
      }
      if (isResourceMissing(error)) {
        ctx.logger?.error?.(
          'Stripe has no record of the instructor payout account',
          { errorName: error instanceof Error ? error.name : 'unknown' },
        );
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: ACCOUNT_NOT_FOUND,
        });
      }
      if (
        error instanceof Error &&
        error.name === 'StripeInvalidRequestError'
      ) {
        ctx.logger?.error?.('Stripe rejected the payout onboarding request', {
          errorName: 'StripeInvalidRequestError',
          code: (error as { code?: string }).code,
        });
      }
      throw error;
    }
  });

export const dashboardLink = courseProcedure
  .output(PayoutLinkOutputSchema)
  .mutation(async ({ ctx }) => {
    const { coreTable } = ctx;
    const payment = await requirePaymentAccount(coreTable);
    const stored = await storedAccount(coreTable, ctx.user.sub, payment);
    if (!stored || stored.status === 'in_progress') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Set up your payout account first',
      });
    }
    const stripe = await stripeFor(payment);
    return {
      url: (await stripe.createLoginLink(stored.connectedAccountId)).url,
    };
  });

export const overview = courseProcedure
  .output(PayoutOverviewOutputSchema)
  .query(async ({ ctx }): Promise<IPayoutOverviewOutput> => {
    const { coreTable } = ctx;
    const instructorId = ctx.user.sub;
    const now = Date.now();
    const current = await currentPaymentAccount(coreTable);
    const stored = current
      ? await storedAccount(coreTable, instructorId, current)
      : undefined;
    // Released earnings are ready only with an active payout account.
    const releasedBucket =
      stored?.status === 'active' ? 'readyMinor' : 'waitingMinor';

    const byCurrency = new Map<
      string,
      IPayoutOverviewOutput['currencies'][0]
    >();
    for (const entry of await openEntries({ coreTable, instructorId })) {
      let figures = byCurrency.get(entry.currency);
      if (!figures) {
        figures = {
          currency: entry.currency,
          onHoldMinor: 0,
          waitingMinor: 0,
          readyMinor: 0,
          heldMinor: 0,
        };
        byCurrency.set(entry.currency, figures);
      }
      if (
        !current ||
        entry.accountId !== current.accountId ||
        entry.mode !== current.mode
      ) {
        figures.heldMinor += entry.netMinor;
      } else if (Date.parse(entry.releaseAt) > now) {
        figures.onHoldMinor += entry.netMinor;
        if (!figures.nextReleaseAt || entry.releaseAt < figures.nextReleaseAt) {
          figures.nextReleaseAt = entry.releaseAt;
        }
      } else {
        figures[releasedBucket] += entry.netMinor;
      }
    }

    const { data } = await coreTable.entities.payout.query
      .primary({ instructorId })
      .go({ pages: 'all', order: 'desc' });
    const payouts: IPayoutOverviewOutput['payouts'] = [];
    for (const payout of data as PayoutRecord[]) {
      // A releasing payout never reached a transfer: it is only shown when it
      // carries the reason Stripe refused it.
      if (payout.status === 'releasing' && !payout.failureReason) continue;
      payouts.push({
        payoutId: payout.payoutId,
        currency: payout.currency,
        amountMinor: payout.amountMinor,
        status:
          payout.status === 'sent'
            ? 'sent'
            : payout.status === 'pending' || payout.status === 'collecting'
              ? 'pending'
              : 'failed',
        failureReason: payout.failureReason,
        createdAt: payout.createdAt,
        settledAt: payout.settledAt,
      });
    }
    return { currencies: [...byCurrency.values()], payouts };
  });
