/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PayoutAccountStatus } from '@discava/core-table';
import Stripe from 'stripe';
import { createStripe } from './client.js';
import { verifyKey } from './connect.js';
import { dropStripeSecretCache, getStripeApiKey } from './secrets.js';

// What the payout features need of Stripe Connect (research R-6, R-7): create
// an instructor's Express account, read its state, send the onboarding and
// dashboard links, create a transfer and find transfers again. Everything runs
// with the administrator's saved key, and only once that key is shown to
// belong to the payment account (Stripe account and mode) the caller works in:
// after the platform changes either, an old key must never move money inside
// the new one. No error or log line from here carries the key.

/** The saved key belongs to another Stripe account or mode than expected. */
export class PaymentAccountMismatchError extends Error {
  constructor() {
    super('The saved Stripe key belongs to another payment account');
    this.name = 'PaymentAccountMismatchError';
  }
}

export interface PaymentAccountRef {
  accountId: string;
  mode: 'test' | 'live';
}

export interface TransferInput {
  /** Also the idempotency key, the transfer group and the metadata. */
  payoutId: string;
  /** The instructor's connected account. */
  destination: string;
  amountMinor: number;
  currency: string;
}

export interface PayoutStripe {
  createExpressAccount(instructorId: string): Promise<Stripe.Account>;
  retrieveAccount(connectedAccountId: string): Promise<Stripe.Account>;
  createAccountLink(input: {
    connectedAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<Stripe.AccountLink>;
  createLoginLink(connectedAccountId: string): Promise<Stripe.LoginLink>;
  createTransfer(input: TransferInput): Promise<Stripe.Transfer>;
  listTransfersByGroup(transferGroup: string): Promise<Stripe.Transfer[]>;
}

// A key already shown to belong to an account, so the account is not asked
// again for every call. Dropped with the key.
let verified:
  | { apiKey: string; accountId: string; mode: 'test' | 'live' }
  | undefined;

const verifiedFor = async (apiKey: string) => {
  if (verified?.apiKey !== apiKey) {
    const { accountId, mode } = await verifyKey(apiKey);
    verified = { apiKey, accountId, mode };
  }
  return verified;
};

const keyFor = async ({
  accountId,
  mode,
}: PaymentAccountRef): Promise<string> => {
  const matches = async () => {
    const apiKey = await getStripeApiKey();
    const key = await verifiedFor(apiKey);
    return key.accountId === accountId && key.mode === mode ? apiKey : null;
  };
  const first = await matches();
  if (first) return first;
  // The key may have been replaced since this process read it.
  dropStripeSecretCache();
  verified = undefined;
  const second = await matches();
  if (second) return second;
  throw new PaymentAccountMismatchError();
};

/** A Stripe client for the saved key, once it is shown to be the account's. */
export const payoutStripe = async (
  account: PaymentAccountRef,
): Promise<PayoutStripe> => {
  const stripe = createStripe(await keyFor(account));
  return {
    createExpressAccount: (instructorId) =>
      stripe.accounts.create(
        {
          type: 'express',
          capabilities: { transfers: { requested: true } },
          metadata: { instructorId },
        },
        {
          idempotencyKey: `payout-account:${account.accountId}:${account.mode}:${instructorId}`,
        },
      ),
    retrieveAccount: (connectedAccountId) =>
      stripe.accounts.retrieve(connectedAccountId),
    createAccountLink: ({ connectedAccountId, returnUrl, refreshUrl }) =>
      stripe.accountLinks.create({
        account: connectedAccountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      }),
    createLoginLink: (connectedAccountId) =>
      stripe.accounts.createLoginLink(connectedAccountId),
    createTransfer: ({ payoutId, destination, amountMinor, currency }) =>
      stripe.transfers.create(
        {
          amount: amountMinor,
          currency: currency.toLowerCase(),
          destination,
          transfer_group: payoutId,
          metadata: { payoutId },
        },
        { idempotencyKey: payoutId },
      ),
    listTransfersByGroup: async (transferGroup) => {
      const transfers: Stripe.Transfer[] = [];
      for await (const transfer of stripe.transfers.list({
        transfer_group: transferGroup,
        limit: 100,
      })) {
        transfers.push(transfer);
      }
      return transfers;
    },
  };
};

/**
 * What the instructor can do with their Stripe account (research R-6): not
 * done with the form is in progress, able to receive transfers and payouts is
 * active, anything else is restricted.
 */
export const mapAccountStatus = (
  account: Pick<
    Stripe.Account,
    'details_submitted' | 'payouts_enabled' | 'capabilities'
  >,
): PayoutAccountStatus => {
  if (!account.details_submitted) return 'in_progress';
  if (account.capabilities?.transfers === 'active' && account.payouts_enabled) {
    return 'active';
  }
  return 'restricted';
};

export type TransferOutcome =
  /** Stripe definitely refused: nothing was sent. */
  | { kind: 'rejected'; reason: string }
  /** The transfer may or may not exist: look before trying again. */
  | { kind: 'uncertain' };

const REASON_MAX = 200;
const KEY_IN_TEXT = /\b[sr]k_(?:test|live)_\w+/g;

/**
 * Sorts a failed transfer into a definite rejection (an invalid-request or
 * permission error) or an uncertain outcome (an idempotency conflict, a
 * timeout or connection error, a 5xx, a rate limit, an authentication error,
 * or anything not recognised). Only a definite rejection may reopen the
 * payout's entries: a transfer that went through must never be paid twice.
 */
export const classifyTransferError = (error: unknown): TransferOutcome => {
  if (
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripePermissionError
  ) {
    return {
      kind: 'rejected',
      reason: (error.message || 'Stripe refused the transfer')
        .replace(KEY_IN_TEXT, '[key]')
        .slice(0, REASON_MAX),
    };
  }
  return { kind: 'uncertain' };
};

/**
 * Whether Stripe refused a Connect call for the platform's own reason: the
 * key lacks the permission, or the account hasn't enabled Connect. That is
 * for the operator to fix, not the instructor.
 */
export const isConnectNotAllowed = (error: unknown): boolean =>
  error instanceof Stripe.errors.StripePermissionError ||
  error instanceof Stripe.errors.StripeInvalidRequestError;

/** Whether Stripe refused the saved key itself: no later call can succeed. */
export const isAuthenticationError = (error: unknown): boolean =>
  error instanceof Stripe.errors.StripeAuthenticationError;
