/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  type EarningEntryRecord,
  earningDayOf,
  queryEarningDays,
  queryEarningLines,
  recordRefund,
  recordRefundReversal,
  recordSale,
} from './earning.js';
import { createFakeCoreTable } from './payment-fake.test.js';
import { calculateFee } from './revenue.js';

const PAID_AT = '2026-11-19T10:00:00.000Z';
const REFUND_AT = '2026-11-20T09:00:00.000Z';

const order = {
  orderId: 'order-1',
  courseId: 'course-1',
  accountId: 'acct_1',
  mode: 'test' as const,
  currency: 'USD',
  listAmount: 1000,
  amount: 800,
  paidAt: PAID_AT,
};

const sale = (
  fake: ReturnType<typeof createFakeCoreTable>,
  over: Partial<typeof order> = {},
  instructorIds = ['b', 'a'],
) =>
  recordSale({
    coreTable: fake.coreTable,
    order: { ...order, ...over },
    instructorIds,
    feeBasisPoints: 2000,
    holdDays: 14,
  });

const refund = (
  fake: ReturnType<typeof createFakeCoreTable>,
  refundedTotal: number,
  occurredAt = REFUND_AT,
  orderId = 'order-1',
) =>
  recordRefund({
    coreTable: fake.coreTable,
    orderId,
    refundedTotal,
    occurredAt,
  });

const sum = (rows: Record<string, any>[], field: string) =>
  rows.reduce((total, row) => total + (row[field] ?? 0), 0);

const entries = (fake: ReturnType<typeof createFakeCoreTable>) =>
  fake.rows('earningEntry') as EarningEntryRecord[];

describe('recordSale', () => {
  it('writes one entry and one summary add per instructor and one earningOrder', async () => {
    const fake = createFakeCoreTable();
    expect(await sale(fake)).toBe(true);

    expect(fake.rows('earningOrder')).toEqual([
      {
        orderId: 'order-1',
        courseId: 'course-1',
        currency: 'USD',
        accountId: 'acct_1',
        mode: 'test',
        grossMinor: 1000,
        discountMinor: 200,
        paidMinor: 800,
        feeMinor: 160,
        feeBasisPoints: 2000,
        instructorIds: ['a', 'b'],
        refundedMinor: 0,
      },
    ]);
    expect(entries(fake)).toHaveLength(2);
    expect(
      entries(fake)
        .map((e) => e.instructorId)
        .sort(),
    ).toEqual(['a', 'b']);
    for (const entry of entries(fake)) {
      expect(entry).toMatchObject({
        kind: 'sale',
        entryId: 'sale-order-1',
        grossMinor: 500,
        discountMinor: 100,
        refundMinor: 0,
        feeMinor: 80,
        netMinor: 320,
        feeBasisPoints: 2000,
        occurredAt: PAID_AT,
        releaseAt: '2026-12-03T10:00:00.000Z',
        accountId: 'acct_1',
        mode: 'test',
        currency: 'USD',
      });
      expect(entry.payoutId).toBeUndefined();
    }
    const days = fake.rows('earningDay');
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({
      day: '2026-11-19',
      courseId: 'course-1',
      currency: 'USD',
      salesCount: 1,
      grossMinor: 500,
      discountMinor: 100,
      refundMinor: 0,
      feeMinor: 80,
      netMinor: 320,
    });
  });

  it('records the same sale again as nothing', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    const before = structuredClone([
      fake.rows('earningOrder'),
      entries(fake),
      fake.rows('earningDay'),
    ]);
    expect(await sale(fake)).toBe(false);
    expect([
      fake.rows('earningOrder'),
      entries(fake),
      fake.rows('earningDay'),
    ]).toEqual(before);
  });

  it('records two at once once, the loser changing nothing', async () => {
    const fake = createFakeCoreTable();
    const results = await Promise.all([sale(fake), sale(fake)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(entries(fake)).toHaveLength(2);
    expect(sum(fake.rows('earningDay'), 'salesCount')).toBe(2);
  });

  it('adds sales of one course and day to the same row', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    await sale(
      fake,
      { orderId: 'order-2', paidAt: '2026-11-19T23:59:59.000Z' },
      ['a'],
    );
    const days = fake.rows('earningDay');
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      salesCount: 2,
      grossMinor: 2000,
      netMinor: 1280,
    });
  });

  it("takes the day from the order's paidAt, not the time of the call", async () => {
    const fake = createFakeCoreTable();
    await sale(fake, { paidAt: '2026-01-02T23:30:00.000Z' }, ['a']);
    expect(fake.rows('earningDay')[0]).toMatchObject({ day: '2026-01-02' });
    expect(earningDayOf('2026-01-02T23:30:00.000Z')).toBe('2026-01-02');
  });

  it('retries after a write conflict instead of calling the sale recorded', async () => {
    const fake = createFakeCoreTable();
    const write = fake.coreTable.transaction.write.bind(
      fake.coreTable.transaction,
    );
    let calls = 0;
    vi.spyOn(fake.coreTable.transaction, 'write').mockImplementation(((
      build: never,
    ) => {
      if (++calls === 1) {
        // Another sale of the same instructor, course and day was writing.
        return {
          go: async () => ({
            canceled: true,
            data: [{ code: 'None' }, { code: 'TransactionConflict' }],
          }),
        };
      }
      return write(build);
    }) as never);

    expect(await sale(fake, {}, ['a'])).toBe(true);
    expect(calls).toBe(2);
    expect(entries(fake)).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('throws, so the queue redelivers, when conflicts do not stop', async () => {
    const fake = createFakeCoreTable();
    vi.spyOn(fake.coreTable.transaction, 'write').mockImplementation((() => ({
      go: async () => ({
        canceled: true,
        data: [{ code: 'TransactionConflict' }],
      }),
    })) as never);
    await expect(sale(fake, {}, ['a'])).rejects.toThrow(/try again/);
    vi.restoreAllMocks();
    expect(entries(fake)).toEqual([]);
  });

  it('refuses an order with no amount, writing nothing', async () => {
    const fake = createFakeCoreTable();
    await expect(sale(fake, { amount: 0 })).rejects.toThrow();
    expect(fake.rows('earningOrder')).toEqual([]);
  });
});

describe('recordRefund', () => {
  it('records negative net and a negative fee after the sale', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    expect(await refund(fake, 400)).toBe(true);

    const refunds = entries(fake).filter((e) => e.kind === 'refund');
    expect(refunds).toHaveLength(2);
    for (const entry of refunds) {
      expect(entry).toMatchObject({
        entryId: 'refund-order-1-400',
        grossMinor: 0,
        discountMinor: 0,
        refundMinor: 200,
        feeMinor: -40,
        netMinor: -160,
        occurredAt: REFUND_AT,
        releaseAt: REFUND_AT,
        feeBasisPoints: 2000,
        accountId: 'acct_1',
        mode: 'test',
        currency: 'USD',
      });
    }
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 400 });
    const refundDays = fake
      .rows('earningDay')
      .filter((d) => d.day === '2026-11-20');
    expect(refundDays).toHaveLength(2);
    expect(refundDays[0]).toMatchObject({
      salesCount: 0,
      refundMinor: 200,
      netMinor: -160,
    });
  });

  it('records the same total twice once', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    expect(await refund(fake, 400)).toBe(true);
    const before = structuredClone(entries(fake));
    expect(await refund(fake, 400)).toBe(false);
    expect(entries(fake)).toEqual(before);
  });

  it('records nothing for a lower total after a higher one', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    await refund(fake, 600);
    const before = structuredClone(entries(fake));
    expect(await refund(fake, 200)).toBe(false);
    expect(entries(fake)).toEqual(before);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 600 });
  });

  it('gives the same sums for totals 1 then 2 as for total 2 alone', async () => {
    // The worked case: paid 2 at 5000 basis points, so the sale's fee is 1.
    const record = (fake: ReturnType<typeof createFakeCoreTable>) =>
      recordSale({
        coreTable: fake.coreTable,
        order: { ...order, listAmount: 2, amount: 2 },
        instructorIds: ['a'],
        feeBasisPoints: 5000,
        holdDays: 0,
      });
    const stepped = createFakeCoreTable();
    const alone = createFakeCoreTable();
    await record(stepped);
    await record(alone);
    await refund(stepped, 1);
    await refund(stepped, 2);
    await refund(alone, 2);
    const refundsOf = (fake: typeof stepped) =>
      entries(fake).filter((e) => e.kind === 'refund');
    for (const field of ['refundMinor', 'feeMinor', 'netMinor'] as const) {
      expect(sum(refundsOf(stepped), field)).toBe(sum(refundsOf(alone), field));
    }
    expect(sum(refundsOf(stepped), 'feeMinor')).toBe(-1);
    expect(sum(refundsOf(stepped), 'refundMinor')).toBe(2);
  });

  it('retries when two refunds of one order race, and returns the fee once', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    // Both read the same total; the first to commit wins, the other recomputes.
    await Promise.all([refund(fake, 300), refund(fake, 800)]);
    expect(fake.log.cancelled).toBeGreaterThanOrEqual(1);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 800 });
    const refunds = entries(fake).filter((e) => e.kind === 'refund');
    expect(sum(refunds, 'refundMinor')).toBe(800);
    expect(sum(refunds, 'feeMinor')).toBe(-calculateFee(800, 2000));
    expect(new Set(refunds.map((e) => e.entryId)).size).toBe(refunds.length);
  });

  it('retries after losing the counter and ends at the higher total', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    let injected = false;
    fake.hooks.beforeTransaction = () => {
      if (injected) return;
      injected = true;
      // Another refund records total 300 just before our first write.
      fake.put('earningOrder', {
        ...fake.rows('earningOrder')[0],
        refundedMinor: 300,
      });
    };
    expect(await refund(fake, 800)).toBe(true);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 800 });
    const refunds = entries(fake).filter((e) => e.kind === 'refund');
    // Ours recomputed from 300, not from 0.
    expect(sum(refunds, 'refundMinor')).toBe(500);
    expect(fake.log.cancelled).toBe(1);
  });

  it('throws after 5 attempts that each lose the counter', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    let raised = 0;
    fake.hooks.beforeTransaction = () => {
      raised += 1;
      fake.put('earningOrder', {
        ...fake.rows('earningOrder')[0],
        refundedMinor: raised,
      });
    };
    await expect(refund(fake, 800)).rejects.toThrow(/try again/);
    expect(raised).toBe(5);
  });

  it('caps a total over the amount paid', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    await refund(fake, 5000);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 800 });
    const refunds = entries(fake).filter((e) => e.kind === 'refund');
    expect(refunds.map((e) => e.entryId)).toEqual(['refund-order-1-800']);
    expect(sum(refunds, 'netMinor')).toBe(
      -sum(
        entries(fake).filter((e) => e.kind === 'sale'),
        'netMinor',
      ),
    );
  });

  it('records nothing, and does not throw, for an order with no earnings', async () => {
    const fake = createFakeCoreTable();
    expect(await refund(fake, 100, REFUND_AT, 'nobody')).toBe(false);
    expect(entries(fake)).toEqual([]);
  });
});

describe('queryEarningDays', () => {
  const seed = async () => {
    const fake = createFakeCoreTable();
    for (const [orderId, paidAt] of [
      ['o1', '2026-11-01T00:00:00.000Z'],
      ['o2', '2026-11-15T12:00:00.000Z'],
      ['o3', '2026-11-30T23:59:59.999Z'],
      ['o4', '2026-12-01T00:00:00.000Z'],
      ['o0', '2026-10-31T23:59:59.999Z'],
    ]) {
      await sale(fake, { orderId, paidAt }, ['a']);
    }
    await sale(fake, { orderId: 'other', paidAt: '2026-11-15T00:00:00.000Z' }, [
      'z',
    ]);
    return fake;
  };

  it('includes both boundary days', async () => {
    const fake = await seed();
    const days = await queryEarningDays({
      coreTable: fake.coreTable,
      instructorId: 'a',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(days.map((d) => d.day)).toEqual([
      '2026-11-01',
      '2026-11-15',
      '2026-11-30',
    ]);
  });

  it("never returns another instructor's rows", async () => {
    const fake = await seed();
    const days = await queryEarningDays({
      coreTable: fake.coreTable,
      instructorId: 'z',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(days).toHaveLength(1);
    expect(days[0]!.instructorId).toBe('z');
  });
});

describe('queryEarningLines', () => {
  it('pages through every line exactly once, in time order', async () => {
    const fake = createFakeCoreTable();
    for (let i = 0; i < 7; i++) {
      await sale(
        fake,
        { orderId: `o${i}`, paidAt: `2026-11-1${i}T10:00:00.000Z` },
        ['a'],
      );
    }
    await sale(fake, { orderId: 'elsewhere', courseId: 'course-2' }, ['a']);
    await sale(fake, { orderId: 'someone-else' }, ['z']);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await queryEarningLines({
        coreTable: fake.coreTable,
        instructorId: 'a',
        courseId: 'course-1',
        from: '2026-11-10',
        to: '2026-11-16',
        cursor,
        limit: 3,
      });
      seen.push(...page.lines.map((l) => l.entryId));
      cursor = page.cursor;
      pages += 1;
    } while (cursor);

    expect(seen).toEqual(
      ['0', '1', '2', '3', '4', '5', '6'].map((i) => `sale-o${i}`),
    );
    expect(pages).toBe(3);
  });

  it('includes the whole last day', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, { paidAt: '2026-11-19T23:59:59.999Z' }, ['a']);
    const page = await queryEarningLines({
      coreTable: fake.coreTable,
      instructorId: 'a',
      courseId: 'course-1',
      from: '2026-11-19',
      to: '2026-11-19',
    });
    expect(page.lines).toHaveLength(1);
  });
});

describe('recordRefundReversal', () => {
  const reverse = (
    fake: ReturnType<typeof createFakeCoreTable>,
    occurredAt = '2026-11-21T00:00:00.000Z',
  ) =>
    recordRefundReversal({
      coreTable: fake.coreTable,
      orderId: 'order-1',
      occurredAt,
    });

  it('puts the earnings back to what they were before the refund, once', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    const netBefore = sum(entries(fake), 'netMinor');
    await refund(fake, 800);
    expect(sum(entries(fake), 'netMinor')).toBeLessThan(netBefore);

    expect(await reverse(fake)).toBe(true);
    for (const field of ['refundMinor', 'feeMinor', 'netMinor'] as const) {
      expect(sum(entries(fake), field)).toBe(
        sum(
          entries(fake).filter((e) => e.kind === 'sale'),
          field,
        ),
      );
    }
    expect(sum(entries(fake), 'netMinor')).toBe(netBefore);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 0 });
    const days = fake.rows('earningDay');
    expect(sum(days, 'netMinor')).toBe(netBefore);
    expect(sum(days, 'refundMinor')).toBe(0);

    const before = structuredClone(entries(fake));
    expect(await reverse(fake)).toBe(false);
    expect(entries(fake)).toEqual(before);
  });

  it('is a new open entry, so a refund a payout took is not edited', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    await refund(fake, 800);
    const refundEntries = entries(fake).filter((e) => e.kind === 'refund');
    await reverse(fake);
    const after = entries(fake).filter((e) => e.kind === 'refund');
    expect(after).toHaveLength(refundEntries.length * 2);
    for (const original of refundEntries) {
      expect(after).toContainEqual(original);
    }
    for (const entry of after.filter((e) =>
      e.entryId.startsWith('refund-reversal-'),
    )) {
      expect(entry.payoutId).toBeUndefined();
      expect(entry.occurredAt).toBe('2026-11-21T00:00:00.000Z');
    }
  });

  it('reverses a partial refund by what was refunded', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    const netBefore = sum(entries(fake), 'netMinor');
    await refund(fake, 400);
    await reverse(fake);
    expect(sum(entries(fake), 'netMinor')).toBe(netBefore);
  });

  it('records nothing when no refund is in the ledger or the order has no earnings', async () => {
    const fake = createFakeCoreTable();
    expect(await reverse(fake)).toBe(false);
    await sale(fake);
    expect(await reverse(fake)).toBe(false);
    expect(entries(fake).filter((e) => e.kind === 'refund')).toEqual([]);
  });

  it('retries after losing the counter, and reverses what is recorded by then', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    await refund(fake, 300);
    let injected = false;
    fake.hooks.beforeTransaction = () => {
      if (injected) return;
      injected = true;
      // Another refund raises the total to 800 just before our first write.
      fake.put('earningOrder', {
        ...fake.rows('earningOrder')[0],
        refundedMinor: 800,
      });
    };
    expect(await reverse(fake)).toBe(true);
    expect(fake.log.cancelled).toBe(1);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 0 });
  });

  it('throws after 5 attempts that each lose the counter', async () => {
    const fake = createFakeCoreTable();
    await sale(fake, {}, ['a']);
    await refund(fake, 300);
    let raised = 300;
    fake.hooks.beforeTransaction = () => {
      raised += 1;
      fake.put('earningOrder', {
        ...fake.rows('earningOrder')[0],
        refundedMinor: raised,
      });
    };
    await expect(reverse(fake)).rejects.toThrow(/try again/);
  });

  it('leaves out a refund image delivered after its reversal, even the first one', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    // The failure image is processed before the refund image it undoes.
    expect(await reverse(fake)).toBe(false);
    expect(fake.rows('earningOrder')[0]).toMatchObject({
      reversedAt: '2026-11-21T00:00:00.000Z',
    });
    expect(await refund(fake, 800)).toBe(false);
    expect(entries(fake).filter((e) => e.kind === 'refund')).toEqual([]);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 0 });
  });

  it('records a second refund of the order after a failed one, and reverses it again', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    const netBefore = sum(entries(fake), 'netMinor');
    await refund(fake, 800);
    await reverse(fake);
    // Support refunds again later: dated after the reversal, so it is new.
    expect(await refund(fake, 800, '2026-11-25T00:00:00.000Z')).toBe(true);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 800 });
    expect(await reverse(fake, '2026-11-26T00:00:00.000Z')).toBe(true);
    expect(sum(entries(fake), 'netMinor')).toBe(netBefore);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 0 });
  });

  it('is not undone by the refund image delivered again afterwards', async () => {
    const fake = createFakeCoreTable();
    await sale(fake);
    await refund(fake, 800);
    await reverse(fake);
    const before = structuredClone(entries(fake));
    expect(await refund(fake, 800)).toBe(false);
    expect(entries(fake)).toEqual(before);
    expect(fake.rows('earningOrder')[0]).toMatchObject({ refundedMinor: 0 });
  });
});
