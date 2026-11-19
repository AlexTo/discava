/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { EarningEntryRecord } from './earning.js';
import { createFakeCoreTable } from './payment-fake.test.js';
import {
  claimPayout,
  createPayout,
  listActiveAccounts,
  listUnsettledPayouts,
  markPayoutFailed,
  markPayoutSent,
  openEntries,
  PAYOUT_CLAIM_GRACE_MS,
  type PayoutRecord,
  releasePayout,
  saveAccountStatus,
} from './payout.js';

const NOW = '2026-12-10T00:00:00.000Z';

type Fake = ReturnType<typeof createFakeCoreTable>;

const entry = (i: number, over: Partial<EarningEntryRecord> = {}) => ({
  instructorId: 'instructor-1',
  courseId: 'course-1',
  orderId: `order-${i}`,
  accountId: 'acct_1',
  mode: 'test',
  entryId: `sale-order-${i}`,
  kind: 'sale',
  currency: 'USD',
  grossMinor: 100,
  discountMinor: 0,
  refundMinor: 0,
  feeMinor: 20,
  netMinor: 80,
  feeBasisPoints: 2000,
  occurredAt: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00.000Z`,
  releaseAt: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00.000Z`,
  settlement: 'open#instructor-1',
  ...over,
});

const seed = (fake: Fake, count: number) => {
  for (let i = 0; i < count; i++) fake.put('earningEntry', entry(i));
  return fake.rows('earningEntry') as EarningEntryRecord[];
};

const create = (fake: Fake, entries: EarningEntryRecord[]) =>
  createPayout({
    coreTable: fake.coreTable,
    instructorId: 'instructor-1',
    accountId: 'acct_1',
    mode: 'test',
    currency: 'USD',
    connectedAccountId: 'acct_connected',
    entries,
    now: NOW,
  });

const payouts = (fake: Fake) => fake.rows('payout') as PayoutRecord[];
const owned = (fake: Fake, payoutId: string) =>
  fake.rows('earningEntry').filter((e) => e.payoutId === payoutId);
const openCount = (fake: Fake) =>
  fake
    .rows('earningEntry')
    .filter(
      (e) => e.payoutId === undefined && e.settlement === 'open#instructor-1',
    ).length;

// A payout in a given state, with entries it owns.
const putPayout = (
  fake: Fake,
  status: PayoutRecord['status'],
  over: Partial<PayoutRecord> = {},
) => {
  const payout: PayoutRecord = {
    instructorId: 'instructor-1',
    payoutId: 'payout-1',
    accountId: 'acct_1',
    mode: 'test',
    currency: 'USD',
    status,
    amountMinor: 0,
    entryCount: 0,
    attemptedAt: NOW,
    connectedAccountId: 'acct_connected',
    createdAt: NOW,
    ...over,
  };
  fake.put('payout', payout);
  return payout;
};

const putOwned = (fake: Fake, payoutId: string, count: number) => {
  for (let i = 0; i < count; i++) {
    fake.put(
      'earningEntry',
      entry(i, { payoutId, settlement: `payout#${payoutId}` } as never),
    );
  }
};

describe('createPayout', () => {
  it('turns 250 entries into one pending payout, collected in three batches', async () => {
    const fake = createFakeCoreTable();
    const entries = seed(fake, 250);
    const write = vi.spyOn(fake.coreTable.transaction, 'write');

    const payout = await create(fake, entries);

    expect(write).toHaveBeenCalledTimes(3);
    expect(payout).toMatchObject({
      status: 'pending',
      amountMinor: 250 * 80,
      entryCount: 250,
      accountId: 'acct_1',
      mode: 'test',
      currency: 'USD',
      connectedAccountId: 'acct_connected',
      attemptedAt: NOW,
    });
    expect(payouts(fake)).toHaveLength(1);
    expect(payouts(fake)[0]).toMatchObject({
      status: 'pending',
      amountMinor: 20000,
      entryCount: 250,
    });
    expect(owned(fake, payout!.payoutId)).toHaveLength(250);
    expect(
      await openEntries({
        coreTable: fake.coreTable,
        instructorId: 'instructor-1',
      }),
    ).toEqual([]);
  });

  it('writes nothing for no entries or a net that is not above 0', async () => {
    const fake = createFakeCoreTable();
    expect(await create(fake, [])).toBeUndefined();
    const refund = entry(1, { netMinor: -80 }) as unknown as EarningEntryRecord;
    expect(await create(fake, [refund])).toBeUndefined();
    expect(payouts(fake)).toEqual([]);
  });

  it('lets one of two concurrent calls over the same entries win, leaving the loser nothing', async () => {
    const fake = createFakeCoreTable();
    const entries = seed(fake, 5);

    const results = await Promise.all([
      create(fake, entries),
      create(fake, entries),
    ]);

    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(payouts(fake)).toHaveLength(1);
    expect(payouts(fake)[0]).toMatchObject({
      status: 'pending',
      entryCount: 5,
    });
    const winner = winners[0]!;
    expect(owned(fake, winner.payoutId)).toHaveLength(5);
    // No entry points at a payout that does not exist.
    for (const e of fake.rows('earningEntry')) {
      expect(e.payoutId).toBe(winner.payoutId);
    }
  });

  it('leaves a collecting payout that releasePayout clears when interrupted after its first batch', async () => {
    const fake = createFakeCoreTable();
    const entries = seed(fake, 150);
    let batches = 0;
    const write = fake.coreTable.transaction.write.bind(
      fake.coreTable.transaction,
    );
    vi.spyOn(fake.coreTable.transaction, 'write').mockImplementation(((
      build: never,
    ) => {
      if (++batches === 2) throw new Error('process died');
      return write(build);
    }) as never);

    await expect(create(fake, entries)).rejects.toThrow('process died');
    vi.restoreAllMocks();

    const [stuck] = payouts(fake);
    expect(stuck).toMatchObject({ status: 'collecting', entryCount: 99 });
    expect(owned(fake, stuck!.payoutId)).toHaveLength(99);

    await releasePayout({
      coreTable: fake.coreTable,
      payout: stuck!,
      now: NOW,
    });

    expect(payouts(fake)).toEqual([]);
    expect(openCount(fake)).toBe(150);
    expect(
      fake.rows('earningEntry').every((e) => e.payoutId === undefined),
    ).toBe(true);
  });

  it('cannot attach a batch to a payout that is releasing', async () => {
    const fake = createFakeCoreTable();
    const entries = seed(fake, 150);
    fake.hooks.beforeTransaction = () => {
      // Recovery has taken the payout over between our two batches.
      const [row] = payouts(fake);
      if (row && row.entryCount === 99 && row.status === 'collecting') {
        fake.hooks.beforeTransaction = undefined;
        fake.put('payout', { ...row, status: 'releasing' });
      }
    };

    expect(await create(fake, entries)).toBeUndefined();

    expect(payouts(fake)).toEqual([]);
    expect(openCount(fake)).toBe(150);
  });
});

describe('releasePayout', () => {
  it('finishes when interrupted halfway and called again', async () => {
    const fake = createFakeCoreTable();
    const payout = putPayout(fake, 'releasing', {
      amountMinor: 20000,
      entryCount: 250,
    });
    putOwned(fake, payout.payoutId, 250);
    let transactions = 0;
    const write = fake.coreTable.transaction.write.bind(
      fake.coreTable.transaction,
    );
    vi.spyOn(fake.coreTable.transaction, 'write').mockImplementation(((
      build: never,
    ) => {
      if (++transactions === 2) throw new Error('process died');
      return write(build);
    }) as never);

    await expect(
      releasePayout({ coreTable: fake.coreTable, payout, now: NOW }),
    ).rejects.toThrow('process died');
    expect(owned(fake, payout.payoutId)).toHaveLength(150);
    vi.restoreAllMocks();

    await releasePayout({ coreTable: fake.coreTable, payout, now: NOW });

    expect(owned(fake, payout.payoutId)).toHaveLength(0);
    expect(openCount(fake)).toBe(250);
    expect(payouts(fake)).toEqual([]);
  });

  it('is safe to call again once it has finished', async () => {
    const fake = createFakeCoreTable();
    const payout = putPayout(fake, 'releasing');
    await releasePayout({ coreTable: fake.coreTable, payout, now: NOW });
    await releasePayout({ coreTable: fake.coreTable, payout, now: NOW });
    expect(payouts(fake)).toEqual([]);
  });

  it('does nothing to a payout that is pending, sent or failed', async () => {
    for (const status of ['pending', 'sent', 'failed'] as const) {
      const fake = createFakeCoreTable();
      const payout = putPayout(fake, status);
      putOwned(fake, payout.payoutId, 3);
      await releasePayout({ coreTable: fake.coreTable, payout, now: NOW });
      expect(payouts(fake)[0]?.status).toBe(status);
      expect(owned(fake, payout.payoutId)).toHaveLength(3);
    }
  });
});

describe('markPayoutFailed', () => {
  it('makes the entries open again, keeping the reason and the attempted amount', async () => {
    const fake = createFakeCoreTable();
    const entries = seed(fake, 3);
    const payout = (await create(fake, entries))!;

    expect(
      await markPayoutFailed({
        coreTable: fake.coreTable,
        payout,
        reason: 'account_closed',
        now: '2026-12-11T00:00:00.000Z',
      }),
    ).toBe(true);

    expect(payouts(fake)).toHaveLength(1);
    expect(payouts(fake)[0]).toMatchObject({
      status: 'failed',
      failureReason: 'account_closed',
      amountMinor: 240,
      entryCount: 3,
      settledAt: '2026-12-11T00:00:00.000Z',
    });
    expect(owned(fake, payout.payoutId)).toHaveLength(0);
    expect(openCount(fake)).toBe(3);
    expect(
      (
        await openEntries({
          coreTable: fake.coreTable,
          instructorId: 'instructor-1',
        })
      ).length,
    ).toBe(3);
  });

  it('cannot fail a sent payout or one that is only collecting', async () => {
    const fake = createFakeCoreTable();
    const sent = putPayout(fake, 'sent', { transferId: 'tr_1' });
    putOwned(fake, sent.payoutId, 2);
    expect(
      await markPayoutFailed({
        coreTable: fake.coreTable,
        payout: sent,
        reason: 'x',
        now: NOW,
      }),
    ).toBe(false);
    await releasePayout({ coreTable: fake.coreTable, payout: sent, now: NOW });
    expect(payouts(fake)[0]).toMatchObject({
      status: 'sent',
      transferId: 'tr_1',
    });
    expect(owned(fake, sent.payoutId)).toHaveLength(2);

    const other = createFakeCoreTable();
    const collecting = putPayout(other, 'collecting');
    expect(
      await markPayoutFailed({
        coreTable: other.coreTable,
        payout: collecting,
        reason: 'x',
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe('markPayoutSent', () => {
  it('moves a pending payout to sent with its transfer', async () => {
    const fake = createFakeCoreTable();
    const payout = putPayout(fake, 'pending', {
      amountMinor: 80,
      entryCount: 1,
    });
    expect(
      await markPayoutSent({
        coreTable: fake.coreTable,
        payout,
        transferId: 'tr_1',
        now: NOW,
      }),
    ).toBe(true);
    expect(payouts(fake)[0]).toMatchObject({
      status: 'sent',
      transferId: 'tr_1',
      settledAt: NOW,
    });
  });

  it('refuses a collecting payout, and a failed one', async () => {
    for (const status of ['collecting', 'failed', 'releasing'] as const) {
      const fake = createFakeCoreTable();
      const payout = putPayout(fake, status);
      expect(
        await markPayoutSent({
          coreTable: fake.coreTable,
          payout,
          transferId: 'tr_1',
          now: NOW,
        }),
      ).toBe(false);
      expect(payouts(fake)[0]?.status).toBe(status);
      expect(payouts(fake)[0]?.transferId).toBeUndefined();
    }
  });
});

describe('listUnsettledPayouts', () => {
  it('returns the unsettled payouts of every instructor, whatever their account', async () => {
    const fake = createFakeCoreTable();
    // One instructor has no account at all, one a restricted one.
    fake.put('payoutAccount', {
      instructorId: 'instructor-2',
      accountId: 'acct_1',
      mode: 'test',
      connectedAccountId: 'acct_x',
      status: 'restricted',
    });
    putPayout(fake, 'collecting', { payoutId: 'p-collecting' });
    putPayout(fake, 'releasing', {
      payoutId: 'p-releasing',
      instructorId: 'instructor-2',
    });
    putPayout(fake, 'pending', {
      payoutId: 'p-pending',
      instructorId: 'instructor-3',
    });
    putPayout(fake, 'sent', { payoutId: 'p-sent' });
    putPayout(fake, 'failed', { payoutId: 'p-failed' });

    const unsettled = await listUnsettledPayouts({ coreTable: fake.coreTable });

    expect(unsettled.map((p) => p.payoutId).sort()).toEqual([
      'p-collecting',
      'p-pending',
      'p-releasing',
    ]);
  });
});

describe('claimPayout', () => {
  const later = new Date(
    new Date(NOW).getTime() + PAYOUT_CLAIM_GRACE_MS + 1000,
  ).toISOString();

  it('lets exactly one of two concurrent calls win', async () => {
    const fake = createFakeCoreTable();
    const payout = putPayout(fake, 'pending');
    const results = await Promise.all([
      claimPayout({ coreTable: fake.coreTable, payout, now: later }),
      claimPayout({ coreTable: fake.coreTable, payout, now: later }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(payouts(fake)[0]?.attemptedAt).toBe(later);
  });

  it('cannot claim a payout attempted within the grace period', async () => {
    const fake = createFakeCoreTable();
    const payout = putPayout(fake, 'pending');
    const soon = new Date(
      new Date(NOW).getTime() + PAYOUT_CLAIM_GRACE_MS - 1000,
    ).toISOString();
    expect(
      await claimPayout({ coreTable: fake.coreTable, payout, now: soon }),
    ).toBe(false);
    expect(payouts(fake)[0]?.attemptedAt).toBe(NOW);
  });
});

describe('payout accounts', () => {
  it('creates an account once and afterwards only moves its status', async () => {
    const fake = createFakeCoreTable();
    const base = {
      coreTable: fake.coreTable,
      instructorId: 'instructor-1',
      accountId: 'acct_1',
      mode: 'test' as const,
      connectedAccountId: 'acct_connected',
    };
    await saveAccountStatus({ ...base, status: 'in_progress' });
    await saveAccountStatus({ ...base, status: 'active' });
    expect(fake.rows('payoutAccount')).toEqual([
      {
        instructorId: 'instructor-1',
        accountId: 'acct_1',
        mode: 'test',
        connectedAccountId: 'acct_connected',
        status: 'active',
      },
    ]);
  });

  it('lists the active accounts of a payment account', async () => {
    const fake = createFakeCoreTable();
    const put = (
      instructorId: string,
      accountId: string,
      mode: string,
      status: string,
    ) =>
      fake.put('payoutAccount', {
        instructorId,
        accountId,
        mode,
        connectedAccountId: `acct_${instructorId}`,
        status,
      });
    put('a', 'acct_1', 'test', 'active');
    put('b', 'acct_1', 'test', 'restricted');
    put('c', 'acct_2', 'test', 'active');
    put('d', 'acct_1', 'live', 'active');

    const active = await listActiveAccounts({
      coreTable: fake.coreTable,
      accountId: 'acct_1',
      mode: 'test',
    });

    expect(active.map((a) => a.instructorId)).toEqual(['a']);
  });
});
