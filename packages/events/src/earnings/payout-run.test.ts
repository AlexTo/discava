/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import {
  PaymentAccountMismatchError,
  type PayoutStripe,
} from '@discava/common-server-utils/stripe/payouts';
import type { PayoutRecord } from '@discava/core-table';
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { createFakeCoreTable } from '../../../databases/core-table/src/helpers/payment-fake.test.js';
import { payoutRun } from './payout-run.js';

type Fake = ReturnType<typeof createFakeCoreTable>;

const NOW = new Date('2026-12-10T00:00:00.000Z');
const LONG_AGO = '2026-12-01T00:00:00.000Z';
const MINIMUM = 1000;

let sequence = 0;
const entry = (over: Record<string, unknown> = {}) => {
  const i = ++sequence;
  return {
    instructorId: 'i1',
    courseId: 'course-1',
    orderId: `order-${i}`,
    accountId: 'acct_1',
    mode: 'test',
    entryId: `sale-order-${i}`,
    kind: 'sale',
    currency: 'usd',
    grossMinor: 1000,
    discountMinor: 0,
    refundMinor: 0,
    feeMinor: 200,
    netMinor: 800,
    feeBasisPoints: 2000,
    occurredAt: '2026-11-01T10:00:00.000Z',
    releaseAt: '2026-11-15T10:00:00.000Z',
    settlement: `open#${over.instructorId ?? 'i1'}`,
    ...over,
  };
};

const seedEntries = (fake: Fake, count: number, over = {}) => {
  for (let n = 0; n < count; n++) fake.put('earningEntry', entry(over));
};

const connect = (fake: Fake, over: Record<string, unknown> = {}) =>
  fake.put('paymentConnection', {
    status: 'active',
    mode: 'test',
    accountId: 'acct_1',
    revision: 1,
    ...over,
  });

const account = (fake: Fake, instructorId = 'i1', over = {}) =>
  fake.put('payoutAccount', {
    instructorId,
    accountId: 'acct_1',
    mode: 'test',
    connectedAccountId: `acct_conn_${instructorId}`,
    status: 'active',
    ...over,
  });

const payoutRow = (over: Partial<PayoutRecord> = {}): PayoutRecord => ({
  instructorId: 'i1',
  payoutId: 'p1',
  accountId: 'acct_1',
  mode: 'test',
  currency: 'usd',
  status: 'pending',
  amountMinor: 2400,
  entryCount: 3,
  attemptedAt: LONG_AGO,
  connectedAccountId: 'acct_conn_i1',
  createdAt: LONG_AGO,
  ...over,
});

// A payout and the entries it holds.
const seedPayout = (fake: Fake, over: Partial<PayoutRecord> = {}) => {
  const payout = payoutRow(over);
  fake.put('payout', payout);
  for (let n = 0; n < 3; n++) {
    fake.put(
      'earningEntry',
      entry({
        instructorId: payout.instructorId,
        payoutId: payout.payoutId,
        settlement: `payout#${payout.payoutId}`,
      }),
    );
  }
  return payout;
};

const activeStripeAccount = {
  details_submitted: true,
  payouts_enabled: true,
  capabilities: { transfers: 'active' },
} as unknown as Stripe.Account;

const stripeError = (Type: keyof typeof Stripe.errors, message = 'nope') =>
  new (Stripe.errors[Type] as new (raw: object) => Error)({
    message,
    type: 'invalid_request_error',
  });

const fakeStripe = (over: Partial<PayoutStripe> = {}) =>
  ({
    createExpressAccount: vi.fn(),
    createAccountLink: vi.fn(),
    createLoginLink: vi.fn(),
    retrieveAccount: vi.fn(async () => activeStripeAccount),
    createTransfer: vi.fn(async ({ payoutId }) => ({ id: `tr_${payoutId}` })),
    listTransfersByGroup: vi.fn(async () => []),
    ...over,
  }) as unknown as PayoutStripe & Record<string, ReturnType<typeof vi.fn>>;

const setup = (stripe = fakeStripe(), fake = createFakeCoreTable()) => {
  const stripeFor = vi.fn(async () => stripe);
  const run = (options?: { graceMs?: number }, minimumMinor = MINIMUM) =>
    payoutRun(
      { coreTable: fake.coreTable, stripeFor, minimumMinor, now: () => NOW },
      options,
    );
  return { fake, stripe, stripeFor, run };
};

const payouts = (fake: Fake) => fake.rows('payout') as PayoutRecord[];
const openCount = (fake: Fake, instructorId = 'i1') =>
  fake
    .rows('earningEntry')
    .filter(
      (e) =>
        e.settlement === `open#${instructorId}` && e.payoutId === undefined,
    ).length;

describe('payoutRun: binding to the payment account', () => {
  it.each([
    ['no connection', undefined],
    ['a changing connection', { status: 'changing' }],
    ['a disconnected connection', { status: 'disconnected' }],
  ])('sends nothing and does not throw with %s', async (_name, over) => {
    const { fake, stripe, stripeFor, run } = setup();
    if (over) connect(fake, over);
    account(fake);
    seedEntries(fake, 3);

    await expect(run()).resolves.toMatchObject({ sent: 0 });

    expect(stripeFor).not.toHaveBeenCalled();
    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(payouts(fake)).toEqual([]);
  });

  it('throws before any transfer or payout write when the key belongs to another account or mode', async () => {
    const { fake, stripe, stripeFor, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 3);
    stripeFor.mockRejectedValue(new PaymentAccountMismatchError());

    await expect(run()).rejects.toThrow(PaymentAccountMismatchError);

    expect(stripeFor).toHaveBeenCalledWith({
      accountId: 'acct_1',
      mode: 'test',
    });
    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(payouts(fake)).toEqual([]);
    expect(openCount(fake)).toBe(3);
  });
});

describe('payoutRun: what is paid', () => {
  it('visits only active accounts of the current payment account', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake, 'i1');
    account(fake, 'i2', { status: 'restricted' });
    account(fake, 'i3', { accountId: 'acct_other' });
    account(fake, 'i4', { mode: 'live' });
    for (const id of ['i1', 'i2', 'i3', 'i4']) {
      seedEntries(fake, 2, { instructorId: id });
    }

    await run();

    expect(stripe.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(payouts(fake).map((p) => p.instructorId)).toEqual(['i1']);
  });

  it('stores a status Stripe now reports restricted and skips the account', async () => {
    const stripe = fakeStripe({
      retrieveAccount: vi.fn(async () => ({
        ...activeStripeAccount,
        payouts_enabled: false,
      })) as never,
    });
    const { fake, run } = setup(stripe);
    connect(fake);
    account(fake);
    seedEntries(fake, 3);

    await run();

    expect(
      fake.row('payoutAccount', {
        instructorId: 'i1',
        accountId: 'acct_1',
        mode: 'test',
      })?.status,
    ).toBe('restricted');
    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(openCount(fake)).toBe(3);
  });

  it('does not send entries inside the hold period', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 3, { releaseAt: '2026-12-20T00:00:00.000Z' });

    await run();

    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(openCount(fake)).toBe(3);
  });

  it.each([
    ['below the minimum', 1, 800],
    ['zero', 2, 0],
    ['negative', 1, -500],
  ])('leaves a sum %s open', async (_name, count, netMinor) => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, count, { netMinor: count === 2 ? 0 : netMinor });
    if (count === 2) fake.put('earningEntry', entry({ netMinor: 0 }));

    await run();

    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(payouts(fake)).toEqual([]);
  });

  it('creates one payout and one transfer for a released sum, keyed by the payout ID', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 3);

    const result = await run();

    const [payout] = payouts(fake);
    expect(result.sent).toBe(1);
    expect(payout).toMatchObject({
      status: 'sent',
      amountMinor: 2400,
      entryCount: 3,
      transferId: `tr_${payout?.payoutId}`,
    });
    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(stripe.createTransfer).toHaveBeenCalledWith({
      payoutId: payout?.payoutId,
      destination: 'acct_conn_i1',
      amountMinor: 2400,
      currency: 'usd',
    });
    expect(openCount(fake)).toBe(0);
  });

  it('pays 250 released entries as one payout and one transfer for their sum', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 250);

    await run();

    expect(payouts(fake)).toHaveLength(1);
    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(stripe.createTransfer.mock.calls[0]?.[0]).toMatchObject({
      amountMinor: 250 * 800,
    });
    expect(openCount(fake)).toBe(0);
  });

  it('never reads open entries or unsettled payouts of another payment account into a run', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 3, { accountId: 'acct_old' });
    seedEntries(fake, 3, { mode: 'live' });
    const otherAccount = seedPayout(fake, {
      payoutId: 'p-old',
      accountId: 'acct_old',
    });
    const otherMode = seedPayout(fake, { payoutId: 'p-live', mode: 'live' });
    const before = structuredClone(fake.rows('earningEntry'));

    await run();

    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(stripe.listTransfersByGroup).not.toHaveBeenCalled();
    expect(fake.rows('earningEntry')).toEqual(before);
    expect(payouts(fake)).toEqual([otherAccount, otherMode]);
  });

  it('nets a refund entry after a payout against the next one', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 3);
    await run();
    seedEntries(fake, 3);
    fake.put(
      'earningEntry',
      entry({ kind: 'refund', netMinor: -1000, entryId: 'refund-x-1' }),
    );

    await run();

    expect(stripe.createTransfer).toHaveBeenCalledTimes(2);
    expect(stripe.createTransfer.mock.calls[1]?.[0]).toMatchObject({
      amountMinor: 3 * 800 - 1000,
    });
  });

  it('sends nothing twice when run twice', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake);
    seedEntries(fake, 3);

    await run();
    await run();

    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(payouts(fake)).toHaveLength(1);
  });

  it('sends once when two runs go at once, the loser releasing its payout', async () => {
    const stripe = fakeStripe();
    const first = setup(stripe);
    connect(first.fake);
    account(first.fake);
    seedEntries(first.fake, 3);
    const second = setup(stripe, first.fake);

    const results = await Promise.allSettled([first.run(), second.run()]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(payouts(first.fake).map((p) => p.status)).toEqual(['sent']);
    expect(openCount(first.fake)).toBe(0);
  });
});

describe('payoutRun: what Stripe says', () => {
  it('records a definite rejection as Failed with the reason and reopens the entries for the next run', async () => {
    const createTransfer = vi
      .fn()
      .mockRejectedValueOnce(
        stripeError('StripeInvalidRequestError', 'No funds'),
      )
      .mockImplementation(async ({ payoutId }) => ({ id: `tr_${payoutId}` }));
    const { fake, run } = setup(fakeStripe({ createTransfer }));
    connect(fake);
    account(fake);
    seedEntries(fake, 3);

    const first = await run();

    expect(first.failed).toBe(1);
    expect(payouts(fake)).toHaveLength(1);
    expect(payouts(fake)[0]).toMatchObject({
      status: 'failed',
      failureReason: 'No funds',
    });
    expect(openCount(fake)).toBe(3);

    await run();

    expect(createTransfer).toHaveBeenCalledTimes(2);
    expect(
      payouts(fake)
        .map((p) => p.status)
        .sort(),
    ).toEqual(['failed', 'sent']);
    expect(openCount(fake)).toBe(0);
  });

  it.each([
    ['an idempotency conflict', () => stripeError('StripeIdempotencyError')],
    ['a timeout', () => stripeError('StripeConnectionError')],
    ['a 5xx', () => stripeError('StripeAPIError')],
    ['a rate limit', () => stripeError('StripeRateLimitError')],
  ])('leaves the payout pending on %s', async (_name, error) => {
    const { fake, run } = setup(
      fakeStripe({ createTransfer: vi.fn().mockRejectedValue(error()) }),
    );
    connect(fake);
    account(fake);
    seedEntries(fake, 3);

    await expect(run()).resolves.toMatchObject({ sent: 0, failed: 0 });

    expect(payouts(fake).map((p) => p.status)).toEqual(['pending']);
    expect(payouts(fake)[0]?.failureReason).toBeUndefined();
    expect(openCount(fake)).toBe(0);
  });

  it('leaves the payout pending and ends the run on an authentication error', async () => {
    const createTransfer = vi
      .fn()
      .mockRejectedValue(stripeError('StripeAuthenticationError'));
    const { fake, run } = setup(fakeStripe({ createTransfer }));
    connect(fake);
    account(fake, 'i1');
    account(fake, 'i2');
    seedEntries(fake, 3, { instructorId: 'i1' });
    seedEntries(fake, 3, { instructorId: 'i2' });

    await expect(run()).rejects.toThrow();

    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(payouts(fake).map((p) => p.status)).toEqual(['pending']);
    expect(openCount(fake, 'i2')).toBe(3);
  });

  it("does not stop the others on one instructor's unexpected error, and throws at the end", async () => {
    const retrieveAccount = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(activeStripeAccount);
    const { fake, stripe, run } = setup(fakeStripe({ retrieveAccount }));
    connect(fake);
    account(fake, 'i1');
    account(fake, 'i2');
    seedEntries(fake, 3, { instructorId: 'i1' });
    seedEntries(fake, 3, { instructorId: 'i2' });

    await expect(run()).rejects.toThrow(/boom/);

    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(payouts(fake)).toHaveLength(1);
  });
});

describe('payoutRun: recovery', () => {
  it.each(['collecting', 'releasing'] as const)(
    'releases a %s payout older than the grace with no Stripe call, and a later payout pays its entries',
    async (status) => {
      const { fake, stripe, run } = setup();
      connect(fake);
      seedPayout(fake, { status });

      const first = await run();

      expect(first.recovered).toBe(1);
      expect(payouts(fake)).toEqual([]);
      expect(openCount(fake)).toBe(3);
      expect(stripe.listTransfersByGroup).not.toHaveBeenCalled();
      expect(stripe.createTransfer).not.toHaveBeenCalled();

      account(fake);
      await run();

      expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves a payout worked on within the grace to the run working on it', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    seedPayout(fake, {
      status: 'pending',
      attemptedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });

    await run();

    expect(stripe.listTransfersByGroup).not.toHaveBeenCalled();
    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(payouts(fake).map((p) => p.status)).toEqual(['pending']);
  });

  it('marks a pending payout sent when its transfer already exists, even past the idempotency window', async () => {
    const { fake, stripe, run } = setup(
      fakeStripe({
        listTransfersByGroup: vi.fn(async () => [{ id: 'tr_exists' }]) as never,
      }),
    );
    connect(fake);
    seedPayout(fake, {
      createdAt: '2026-11-01T00:00:00.000Z',
      attemptedAt: '2026-11-01T00:00:00.000Z',
    });

    await run();

    expect(stripe.listTransfersByGroup).toHaveBeenCalledWith('p1');
    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(payouts(fake)[0]).toMatchObject({
      status: 'sent',
      transferId: 'tr_exists',
    });
  });

  it('resends a pending payout with no transfer under the same key', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    seedPayout(fake);

    await run();

    expect(stripe.createTransfer).toHaveBeenCalledWith({
      payoutId: 'p1',
      destination: 'acct_conn_i1',
      amountMinor: 2400,
      currency: 'usd',
    });
    expect(payouts(fake)[0]?.status).toBe('sent');
  });

  it('recovers pending payouts of an instructor whose account is no longer active', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    account(fake, 'i1', { status: 'restricted' });
    seedPayout(fake);

    await run();

    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(payouts(fake)[0]?.status).toBe('sent');
  });

  it('claims once: a run that loses the claim does not resend', async () => {
    const stripe = fakeStripe();
    const first = setup(stripe);
    connect(first.fake);
    seedPayout(first.fake);
    const second = setup(stripe, first.fake);

    await Promise.all([first.run(), second.run()]);

    expect(stripe.createTransfer).toHaveBeenCalledTimes(1);
    expect(payouts(first.fake)[0]?.status).toBe('sent');
  });

  it('does not resend a payout another run is still sending, and treats its same-key conflict as uncertain', async () => {
    // Run A is mid-send: its payout is pending with a fresh attemptedAt, and
    // B's own transfer call for it would conflict on the idempotency key.
    const createTransfer = vi
      .fn()
      .mockRejectedValue(stripeError('StripeIdempotencyError'));
    const { fake, stripe, run } = setup(fakeStripe({ createTransfer }));
    connect(fake);
    const inFlight = seedPayout(fake, {
      attemptedAt: new Date(NOW.getTime() - 1000).toISOString(),
    });

    await run();

    expect(stripe.createTransfer).not.toHaveBeenCalled();
    expect(payouts(fake)[0]).toMatchObject({ status: 'pending' });

    // A then finishes, and B's conflicting call (a later pass, claim lost on
    // the same key) must not reopen the entries.
    account(fake);
    fake.put('payout', { ...inFlight, attemptedAt: LONG_AGO });
    await run();
    expect(payouts(fake)[0]?.status).toBe('pending');
    expect(
      fake.rows('earningEntry').every((e) => e.payoutId === inFlight.payoutId),
    ).toBe(true);
  });

  it('lets a run with a zero grace recover a payout an earlier run just left', async () => {
    const { fake, stripe, run } = setup();
    connect(fake);
    seedPayout(fake, { status: 'collecting', attemptedAt: NOW.toISOString() });

    await run({ graceMs: 0 });

    expect(payouts(fake)).toEqual([]);
    expect(openCount(fake)).toBe(3);
    expect(stripe.createTransfer).not.toHaveBeenCalled();
  });
});
