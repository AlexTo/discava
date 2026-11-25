/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A key of its own per test: a verified key is remembered by its value.
let KEY = 'sk_test_abcdefghij1234';
let OTHER_KEY = 'sk_test_zzzzzzzzzz9999';
let n = 0;

const { stripe, getStripeApiKey, dropStripeSecretCache, verifyKey } =
  vi.hoisted(() => ({
    stripe: {
      accounts: {
        create: vi.fn(),
        retrieve: vi.fn(),
        createLoginLink: vi.fn(),
      },
      accountLinks: { create: vi.fn() },
      transfers: { create: vi.fn(), list: vi.fn() },
    },
    getStripeApiKey: vi.fn(),
    dropStripeSecretCache: vi.fn(),
    verifyKey: vi.fn(),
  }));
vi.mock('./client.js', () => ({ createStripe: vi.fn(() => stripe) }));
vi.mock('./secrets.js', () => ({ getStripeApiKey, dropStripeSecretCache }));
vi.mock('./connect.js', () => ({ verifyKey }));

import { createStripe } from './client.js';
import {
  classifyTransferError,
  isConnectNotAllowed,
  isResourceMissing,
  mapAccountStatus,
  PaymentAccountMismatchError,
  payoutStripe,
} from './payouts.js';
import { PaymentsNotConnectedError } from './secrets-store.js';

const ACCOUNT = { accountId: 'acct_platform', mode: 'test' } as const;
const verified = (accountId: string, mode: 'test' | 'live') => ({
  accountId,
  mode,
  accountName: 'x',
  keyLast4: '1234',
});

beforeEach(() => {
  vi.clearAllMocks();
  n++;
  KEY = `sk_test_abcdefghij${n}`;
  OTHER_KEY = `sk_test_zzzzzzzzzz${n}`;
  getStripeApiKey.mockResolvedValue(KEY);
  verifyKey.mockResolvedValue(verified('acct_platform', 'test'));
});

describe('mapAccountStatus', () => {
  it.each([
    ['details not submitted', { details_submitted: false }, 'in_progress'],
    [
      'transfers active and payouts enabled',
      {
        details_submitted: true,
        payouts_enabled: true,
        capabilities: { transfers: 'active' },
      },
      'active',
    ],
    [
      'requirements outstanding (payouts disabled)',
      {
        details_submitted: true,
        payouts_enabled: false,
        capabilities: { transfers: 'active' },
      },
      'restricted',
    ],
    [
      'transfers inactive',
      {
        details_submitted: true,
        payouts_enabled: true,
        capabilities: { transfers: 'inactive' },
      },
      'restricted',
    ],
    [
      'transfers pending',
      {
        details_submitted: true,
        payouts_enabled: true,
        capabilities: { transfers: 'pending' },
      },
      'restricted',
    ],
    [
      'no capabilities',
      { details_submitted: true, payouts_enabled: true },
      'restricted',
    ],
  ])('%s is %s', (_name, account, status) => {
    expect(mapAccountStatus(account as never)).toBe(status);
  });
});

describe('payoutStripe', () => {
  it('builds the client from the saved key once it is the account’s', async () => {
    await payoutStripe(ACCOUNT);
    expect(verifyKey).toHaveBeenCalledWith(KEY);
    expect(createStripe).toHaveBeenCalledWith(KEY);
  });

  it('refuses a key of another account', async () => {
    verifyKey.mockResolvedValue(verified('acct_other', 'test'));
    await expect(payoutStripe(ACCOUNT)).rejects.toBeInstanceOf(
      PaymentAccountMismatchError,
    );
    expect(createStripe).not.toHaveBeenCalled();
  });

  it('refuses a key of the same account in the other mode', async () => {
    verifyKey.mockResolvedValue(verified('acct_platform', 'live'));
    await expect(payoutStripe(ACCOUNT)).rejects.toBeInstanceOf(
      PaymentAccountMismatchError,
    );
  });

  it('re-reads a stale cached key once, and uses the new one', async () => {
    getStripeApiKey.mockResolvedValueOnce(OTHER_KEY).mockResolvedValue(KEY);
    verifyKey
      .mockResolvedValueOnce(verified('acct_old', 'test'))
      .mockResolvedValueOnce(verified('acct_platform', 'test'));
    await payoutStripe(ACCOUNT);
    expect(dropStripeSecretCache).toHaveBeenCalledTimes(1);
    expect(createStripe).toHaveBeenCalledWith(KEY);
  });

  it('reads the key only twice when it still differs', async () => {
    verifyKey.mockResolvedValue(verified('acct_other', 'test'));
    await payoutStripe(ACCOUNT).catch(() => undefined);
    expect(getStripeApiKey).toHaveBeenCalledTimes(2);
    expect(dropStripeSecretCache).toHaveBeenCalledTimes(1);
  });

  it('lets PaymentsNotConnectedError through', async () => {
    getStripeApiKey.mockRejectedValue(new PaymentsNotConnectedError());
    await expect(payoutStripe(ACCOUNT)).rejects.toBeInstanceOf(
      PaymentsNotConnectedError,
    );
  });

  it('never puts the key in the mismatch error', async () => {
    verifyKey.mockResolvedValue(verified('acct_other', 'test'));
    const error = (await payoutStripe(ACCOUNT).catch((e) => e)) as Error;
    expect(String(error.message)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(String(error.stack)).not.toContain(KEY);
  });

  it('creates an Express account asking for transfers only, idempotently per instructor', async () => {
    stripe.accounts.create.mockResolvedValue({ id: 'acct_i1' });
    const client = await payoutStripe(ACCOUNT);
    await client.createExpressAccount('instr-1');
    expect(stripe.accounts.create).toHaveBeenCalledWith(
      {
        type: 'express',
        capabilities: { transfers: { requested: true } },
        metadata: { instructorId: 'instr-1' },
      },
      {
        idempotencyKey: 'payout-account:acct_platform:test:instr-1',
      },
    );
  });

  it('retrieves an account and makes account and login links', async () => {
    stripe.accounts.retrieve.mockResolvedValue({ id: 'acct_i1' });
    stripe.accountLinks.create.mockResolvedValue({ url: 'https://link' });
    stripe.accounts.createLoginLink.mockResolvedValue({ url: 'https://dash' });
    const client = await payoutStripe(ACCOUNT);
    await client.retrieveAccount('acct_i1');
    await client.createAccountLink({
      connectedAccountId: 'acct_i1',
      returnUrl: 'https://p/return',
      refreshUrl: 'https://p/refresh',
    });
    await client.createLoginLink('acct_i1');
    expect(stripe.accounts.retrieve).toHaveBeenCalledWith('acct_i1');
    expect(stripe.accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_i1',
      type: 'account_onboarding',
      return_url: 'https://p/return',
      refresh_url: 'https://p/refresh',
    });
    expect(stripe.accounts.createLoginLink).toHaveBeenCalledWith('acct_i1');
  });

  it('always passes an idempotency key, group and metadata to a transfer', async () => {
    stripe.transfers.create.mockResolvedValue({ id: 'tr_1' });
    const client = await payoutStripe(ACCOUNT);
    await client.createTransfer({
      payoutId: 'po_1',
      destination: 'acct_i1',
      amountMinor: 5000,
      currency: 'usd',
    });
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      {
        amount: 5000,
        currency: 'usd',
        destination: 'acct_i1',
        transfer_group: 'po_1',
        metadata: { payoutId: 'po_1' },
      },
      { idempotencyKey: 'po_1' },
    );
  });

  it('lists the transfers of one group, over every page', async () => {
    stripe.transfers.list.mockReturnValue(
      (async function* () {
        yield { id: 'tr_1' };
        yield { id: 'tr_2' };
      })(),
    );
    const client = await payoutStripe(ACCOUNT);
    await expect(client.listTransfersByGroup('po_1')).resolves.toEqual([
      { id: 'tr_1' },
      { id: 'tr_2' },
    ]);
    expect(stripe.transfers.list).toHaveBeenCalledWith({
      transfer_group: 'po_1',
      limit: 100,
    });
  });
});

describe('isConnectNotAllowed / isResourceMissing', () => {
  const invalid = (message: string, code?: string) =>
    new Stripe.errors.StripeInvalidRequestError({
      message,
      type: 'invalid_request_error',
      code,
    } as never);

  it('matches a permission error and the Connect sign-up message', () => {
    expect(
      isConnectNotAllowed(
        new Stripe.errors.StripePermissionError({ message: 'x' } as never),
      ),
    ).toBe(true);
    expect(
      isConnectNotAllowed(
        invalid(
          "You can only create new accounts if you've signed up for Connect",
        ),
      ),
    ).toBe(true);
  });

  it('does not match other invalid requests', () => {
    expect(
      isConnectNotAllowed(invalid('No such account', 'resource_missing')),
    ).toBe(false);
    expect(isConnectNotAllowed(invalid('Not a valid URL', 'url_invalid'))).toBe(
      false,
    );
    expect(isConnectNotAllowed(new Error('x'))).toBe(false);
  });

  it('finds resource_missing only', () => {
    expect(
      isResourceMissing(invalid('No such account', 'resource_missing')),
    ).toBe(true);
    expect(isResourceMissing(invalid('Not a valid URL', 'url_invalid'))).toBe(
      false,
    );
    expect(isResourceMissing(new Error('x'))).toBe(false);
  });
});

describe('classifyTransferError', () => {
  const make = (Ctor: new (raw: never) => Error, message = 'boom') =>
    new Ctor({ message, type: 'x' } as never);

  it.each([
    ['StripeInvalidRequestError', Stripe.errors.StripeInvalidRequestError],
    ['StripePermissionError', Stripe.errors.StripePermissionError],
  ])('treats %s as a definite rejection', (_name, Ctor) => {
    expect(classifyTransferError(make(Ctor as never, 'No funds'))).toEqual({
      kind: 'rejected',
      reason: 'No funds',
    });
  });

  it.each([
    ['StripeIdempotencyError', Stripe.errors.StripeIdempotencyError],
    ['StripeConnectionError', Stripe.errors.StripeConnectionError],
    ['StripeAPIError', Stripe.errors.StripeAPIError],
    ['StripeRateLimitError', Stripe.errors.StripeRateLimitError],
    ['StripeAuthenticationError', Stripe.errors.StripeAuthenticationError],
  ])('treats %s as uncertain', (_name, Ctor) => {
    expect(classifyTransferError(make(Ctor as never))).toEqual({
      kind: 'uncertain',
    });
  });

  it('treats an unknown error as uncertain', () => {
    expect(classifyTransferError(new Error('timeout'))).toEqual({
      kind: 'uncertain',
    });
    expect(classifyTransferError('x')).toEqual({ kind: 'uncertain' });
  });

  it('keeps a key out of the reason, and the reason short', () => {
    const outcome = classifyTransferError(
      make(
        Stripe.errors.StripeInvalidRequestError as never,
        `bad ${KEY} ${'x'.repeat(500)}`,
      ),
    );
    expect(outcome.kind).toBe('rejected');
    const reason = (outcome as { reason: string }).reason;
    expect(reason).not.toContain(KEY);
    expect(reason.length).toBeLessThanOrEqual(200);
  });
});
