/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
  classifyTransferError,
  isAuthenticationError,
  mapAccountStatus,
  type PaymentAccountRef,
  type PayoutStripe,
  payoutStripe,
} from '@discava/common-server-utils/stripe/payouts';
import {
  claimPayout,
  createCoreTableService,
  createPayout,
  getConnection,
  listActiveAccounts,
  listUnsettledPayouts,
  markPayoutFailed,
  markPayoutSent,
  openEntries,
  type PayoutRecord,
  releasePayout,
  saveAccountStatus,
} from '@discava/core-table';
import middy from '@middy/core';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'PayoutRun';
process.env.POWERTOOLS_SERVICE_NAME = 'PayoutRun';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

export interface PayoutRunDeps {
  coreTable: CoreTable;
  /** A Stripe client for the saved key, once shown to be the account's; throws if it is not. */
  stripeFor: (account: PaymentAccountRef) => Promise<PayoutStripe>;
  /** A currency's released sum below this stays open. */
  minimumMinor: number;
  now?: () => Date;
}

export interface PayoutRunOptions {
  /** Replaces the recovery grace; for local tests only. */
  graceMs?: number;
}

export interface PayoutRunResult {
  sent: number;
  failed: number;
  recovered: number;
}

// Ends the run: Stripe refused the key, so no later call can succeed.
class RunAborted extends Error {}

// Sends released earnings to instructors, once (contract:
// events-earnings-and-payout-run.md, `events-payout-run`). Nothing is sent
// twice: a second run finds no open released entries, loses an entry's
// condition while collecting, or loses the recovery claim; and a payout is
// never marked failed, nor its entries reopened, unless Stripe definitely
// refused the transfer.
export const payoutRun = async (
  { coreTable, stripeFor, minimumMinor, now = () => new Date() }: PayoutRunDeps,
  { graceMs }: PayoutRunOptions = {},
): Promise<PayoutRunResult> => {
  const result: PayoutRunResult = { sent: 0, failed: 0, recovered: 0 };

  // 0. Bind to the payment account.
  const connection = await getConnection(coreTable);
  if (connection?.status !== 'active' || !connection.accountId) {
    logger.info('Payments are not connected; nothing sent');
    return result;
  }
  const { accountId, mode } = connection;
  const stripe = await stripeFor({ accountId, mode });
  const failures: unknown[] = [];

  // Creates the transfer of a sealed payout and records how it ended.
  const send = async (payout: PayoutRecord) => {
    try {
      const transfer = await stripe.createTransfer({
        payoutId: payout.payoutId,
        destination: payout.connectedAccountId,
        amountMinor: payout.amountMinor,
        currency: payout.currency,
      });
      if (
        await markPayoutSent({
          coreTable,
          payout,
          transferId: transfer.id,
          now: now().toISOString(),
        })
      ) {
        result.sent++;
      }
    } catch (error) {
      if (isAuthenticationError(error)) {
        logger.error('Stripe refused the saved key', {
          payoutId: payout.payoutId,
        });
        throw new RunAborted();
      }
      const outcome = classifyTransferError(error);
      if (outcome.kind === 'rejected') {
        await markPayoutFailed({
          coreTable,
          payout,
          reason: outcome.reason,
          now: now().toISOString(),
        });
        result.failed++;
        return;
      }
      // Uncertain: the transfer may exist. Left pending for a later run.
      logger.warn('Transfer outcome unknown; payout left pending', {
        payoutId: payout.payoutId,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  };

  try {
    // 1. Recover unsettled payouts of this payment account.
    for (const listed of await listUnsettledPayouts({ coreTable })) {
      if (listed.accountId !== accountId || listed.mode !== mode) continue;
      try {
        const claimed = await claimPayout({
          coreTable,
          payout: listed,
          now: now().toISOString(),
          graceMs,
        });
        if (!claimed) continue;
        if (listed.status !== 'pending') {
          await releasePayout({
            coreTable,
            payout: listed,
            now: now().toISOString(),
          });
          result.recovered++;
          continue;
        }
        const [existing] = await stripe.listTransfersByGroup(listed.payoutId);
        if (existing) {
          await markPayoutSent({
            coreTable,
            payout: listed,
            transferId: existing.id,
            now: now().toISOString(),
          });
          result.recovered++;
        } else {
          await send(listed);
        }
      } catch (error) {
        if (error instanceof RunAborted) throw error;
        failures.push(error);
        logger.error('Could not recover a payout', {
          payoutId: listed.payoutId,
          error,
        });
      }
    }

    // 2. Each active account of this payment account.
    for (const account of await listActiveAccounts({
      coreTable,
      accountId,
      mode,
    })) {
      try {
        const status = mapAccountStatus(
          await stripe.retrieveAccount(account.connectedAccountId),
        );
        if (status !== 'active') {
          await saveAccountStatus({ coreTable, ...account, status });
          continue;
        }

        // 3. Per currency, what has been released.
        const released = (
          await openEntries({ coreTable, instructorId: account.instructorId })
        ).filter(
          (entry) =>
            entry.accountId === accountId &&
            entry.mode === mode &&
            new Date(entry.releaseAt).getTime() <= now().getTime(),
        );
        const currencies = [...new Set(released.map((e) => e.currency))];
        for (const currency of currencies) {
          const entries = released.filter((e) => e.currency === currency);
          const total = entries.reduce((sum, e) => sum + e.netMinor, 0);
          if (total <= 0 || total < minimumMinor) continue;

          // 4. Collect, seal and send.
          const payout = await createPayout({
            coreTable,
            instructorId: account.instructorId,
            accountId,
            mode,
            currency,
            connectedAccountId: account.connectedAccountId,
            entries,
            now: now().toISOString(),
          });
          if (payout) await send(payout);
        }
      } catch (error) {
        if (error instanceof RunAborted) throw error;
        failures.push(error);
        logger.error('Could not pay an instructor', {
          instructorId: account.instructorId,
          error,
        });
      }
    }
  } catch (error) {
    if (!(error instanceof RunAborted)) throw error;
    failures.push(error);
  }

  logger.info('Payout run finished', { ...result, failures: failures.length });
  metrics.addMetric('PayoutsSent', MetricUnit.Count, result.sent);
  metrics.addMetric('PayoutsFailed', MetricUnit.Count, result.failed);
  // 5. One instructor's failure did not stop the others; the run still fails.
  if (failures.length > 0) {
    throw new Error(
      `Payout run failed for ${failures.length} item(s): ${String(failures[0])}`,
    );
  }
  return result;
};

/** The stage's smallest payout, read from the environment (throws if missing or invalid). */
export const readMinimumPayout = (): number => {
  const raw = process.env.PAYOUT_MINIMUM_MINOR;
  const value = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `PAYOUT_MINIMUM_MINOR must be a non-negative integer, got ${String(raw)}`,
    );
  }
  return value;
};

/** One run against the real table and Stripe; the local event runner calls it too. */
export const runPayouts = async (
  options: PayoutRunOptions = {},
): Promise<PayoutRunResult> =>
  payoutRun(
    {
      coreTable: await createCoreTableService(),
      stripeFor: payoutStripe,
      minimumMinor: readMinimumPayout(),
    },
    options,
  );

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(async () => {
    await runPayouts();
  });
