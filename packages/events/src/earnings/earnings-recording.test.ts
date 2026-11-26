/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { calculateRefund, calculateSale } from '@discava/core-table';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EarningsWrites,
  earningsRecording,
  readEarningsSettings,
} from './earnings-recording.js';

type Event = Parameters<typeof earningsRecording>[0];

const SETTINGS = { feeBasisPoints: 2000, holdDays: 14 };

let sequence = 0;
const orderImage = (overrides: Record<string, unknown> = {}) => ({
  __edb_e__: 'order',
  orderId: 'o1',
  courseId: 'c1',
  userId: 'buyer',
  accountId: 'acct_1',
  mode: 'test',
  currency: 'usd',
  listAmount: 1001,
  amount: 1001,
  status: 'paid',
  paidAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:00.000Z',
  ...overrides,
});
const record = (
  image: Record<string, unknown>,
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE' = 'MODIFY',
) => ({
  eventID: `e${++sequence}`,
  eventName,
  dynamodb: { NewImage: image },
});
const batch = (...records: ReturnType<typeof record>[]) =>
  ({ Records: records }) as unknown as Event;

const partly = (total: number, at = '2026-11-20T00:00:00.000Z') =>
  orderImage({ refundedAmount: total, updatedAt: at });
const fully = (at = '2026-11-21T00:00:00.000Z') =>
  orderImage({
    status: 'refunded',
    refundReason: 'requested',
    refundedAmount: 1001,
    refundedAt: at,
    updatedAt: at,
  });

// An in-memory ledger standing in for core-table's writers (which have their
// own tests): the same sale is recorded once, a refund total only counts when
// it rises, and the shares come from the real revenue rules.
const memoryLedger = (
  instructorIds: string[] = ['i1', 'i2'],
  failOn?: (orderId: string) => boolean,
) => {
  const sales = new Map<string, ReturnType<typeof calculateSale>>();
  const refundedMinor = new Map<string, number>();
  const refunds: Record<string, number>[] = [];
  const writes: EarningsWrites = {
    instructorIds: vi.fn(async () => instructorIds),
    recordSale: vi.fn(async (input) => {
      if (failOn?.(input.orderId)) throw new Error('write failed');
      if (sales.has(input.orderId)) return false;
      sales.set(
        input.orderId,
        calculateSale({
          grossMinor: input.listAmount,
          paidMinor: input.amount,
          feeBasisPoints: input.feeBasisPoints,
          instructorIds: input.instructorIds,
        }),
      );
      refundedMinor.set(input.orderId, 0);
      return true;
    }),
    recordRefund: vi.fn(async ({ orderId, refundedTotal }) => {
      const sale = sales.get(orderId);
      const recorded = refundedMinor.get(orderId) ?? 0;
      if (!sale || Math.min(refundedTotal, 1001) <= recorded) return false;
      const shares = calculateRefund({
        grossMinor: 1001,
        paidMinor: 1001,
        feeBasisPoints: SETTINGS.feeBasisPoints,
        instructorIds,
        recordedRefundedMinor: recorded,
        refundedTotalMinor: refundedTotal,
      });
      refundedMinor.set(orderId, Math.min(refundedTotal, 1001));
      refunds.push(
        Object.fromEntries(
          shares.map((s) => [
            s.instructorId,
            s.refundMinor * 1e6 + s.feeMinor * 1e3 + s.netMinor,
          ]),
        ),
      );
      return true;
    }),
    recordRefundReversal: vi.fn(async ({ orderId }) => {
      if (!refundedMinor.get(orderId)) return false;
      refundedMinor.set(orderId, 0);
      return true;
    }),
  };
  const sums = () => {
    const total: Record<string, number> = {};
    for (const share of refunds.flatMap((r) => Object.entries(r))) {
      total[share[0]] = (total[share[0]] ?? 0) + share[1];
    }
    return total;
  };
  return { writes, sales, refundedMinor, sums };
};

const run = (event: Event, writes: EarningsWrites) =>
  earningsRecording(event, writes, SETTINGS);

describe('earningsRecording', () => {
  it('takes back a refund the order says failed, once, however often it is delivered', async () => {
    const { writes, refundedMinor } = memoryLedger();
    const failed = orderImage({
      refundFailedAt: '2026-11-22T00:00:00.000Z',
      updatedAt: '2026-11-22T00:00:00.000Z',
    });

    await run(batch(record(orderImage(), 'INSERT'), record(fully())), writes);
    expect(refundedMinor.get('o1')).toBe(1001);
    await run(batch(record(failed), record(failed)), writes);

    expect(refundedMinor.get('o1')).toBe(0);
    expect(writes.recordRefundReversal).toHaveBeenCalledWith({
      orderId: 'o1',
      occurredAt: '2026-11-22T00:00:00.000Z',
    });
  });

  it('asks for no reversal for an order that never failed a refund', async () => {
    const { writes } = memoryLedger();
    await run(batch(record(orderImage(), 'INSERT'), record(fully())), writes);
    expect(writes.recordRefundReversal).not.toHaveBeenCalled();
  });

  it('records a paid order as a sale with the stage settings', async () => {
    const { writes } = memoryLedger();

    const result = await run(batch(record(orderImage(), 'INSERT')), writes);

    expect(result).toMatchObject({ sales: 1, refunds: 0 });
    expect(writes.recordSale).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        instructorIds: ['i1', 'i2'],
        feeBasisPoints: 2000,
        holdDays: 14,
      }),
    );
    expect(writes.recordRefund).not.toHaveBeenCalled();
  });

  it('records the same record delivered twice, and a batch of duplicates, once', async () => {
    const { writes, sales } = memoryLedger();
    const image = orderImage();

    const first = await run(
      batch(record(image), record(image), record(image)),
      writes,
    );
    const again = await run(batch(record(image)), writes);

    expect(first.sales).toBe(1);
    expect(again.sales).toBe(0);
    expect(sales.size).toBe(1);
  });

  it('ends with the same entries whatever order a sale and its refunds arrive in', async () => {
    const images = [orderImage(), partly(300), fully()];
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const results = [];
    for (const order of permutations) {
      const ledger = memoryLedger();
      await run(batch(...order.map((i) => record(images[i]))), ledger.writes);
      results.push({
        sales: [...ledger.sales.values()],
        refunded: [...ledger.refundedMinor.values()],
        sums: ledger.sums(),
      });
    }
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0].refunded).toEqual([1001]);
  });

  it('records the sale and one refund from a fully refunded image delivered alone', async () => {
    const { writes, sales, refundedMinor } = memoryLedger();

    const result = await run(batch(record(fully())), writes);

    expect(result).toMatchObject({ sales: 1, refunds: 1 });
    expect(sales.size).toBe(1);
    expect(refundedMinor.get('o1')).toBe(1001);
  });

  it('still records earnings for an instructor with no payout account', async () => {
    // Recording never reads payout accounts (FR-022).
    const { writes } = memoryLedger(['no-payout-account']);

    const result = await run(batch(record(orderImage())), writes);

    expect(result.sales).toBe(1);
  });

  it.each([
    ['an undeliverable order', fully()],
    ['an unpaid order', orderImage({ status: 'pending', paidAt: undefined })],
    ['an expired order', orderImage({ status: 'expired' })],
    ['a free order', orderImage({ amount: 0, listAmount: 0 })],
    ['a record of another entity', { ...orderImage(), __edb_e__: 'enrolment' }],
  ])('skips %s', async (name, image) => {
    const { writes } = memoryLedger();
    const skippedImage =
      name === 'an undeliverable order'
        ? { ...image, refundReason: 'duplicate' }
        : image;

    const result = await run(batch(record(skippedImage)), writes);

    expect(result).toEqual({ sales: 0, refunds: 0, skipped: 1 });
    expect(writes.recordSale).not.toHaveBeenCalled();
  });

  it('skips a removed order', async () => {
    const { writes } = memoryLedger();

    const result = await run(batch(record(orderImage(), 'REMOVE')), writes);

    expect(result.skipped).toBe(1);
    expect(writes.recordSale).not.toHaveBeenCalled();
  });

  it('records nothing for a course with no instructor', async () => {
    const { writes } = memoryLedger([]);

    const result = await run(batch(record(orderImage())), writes);

    expect(result).toEqual({ sales: 0, refunds: 0, skipped: 1 });
    expect(writes.recordSale).not.toHaveBeenCalled();
  });

  it('applies what it can, then throws; the redelivered batch changes nothing applied', async () => {
    let failing = true;
    const ledger = memoryLedger(['i1'], (id) => failing && id === 'bad');
    const event = batch(
      record(orderImage({ orderId: 'bad' })),
      record(orderImage({ orderId: 'good' })),
    );

    await expect(run(event, ledger.writes)).rejects.toThrow('write failed');
    expect([...ledger.sales.keys()]).toEqual(['good']);

    failing = false;
    const again = await run(event, ledger.writes);
    expect(again.sales).toBe(1);
    expect([...ledger.sales.keys()].sort()).toEqual(['bad', 'good']);
  });
});

describe('readEarningsSettings', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reads the fee and the hold', () => {
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', '2000');
    vi.stubEnv('PAYOUT_HOLD_DAYS', '14');
    expect(readEarningsSettings()).toEqual({
      feeBasisPoints: 2000,
      holdDays: 14,
    });
  });

  it.each([
    ['', '14'],
    ['10001', '14'],
    ['12.5', '14'],
    ['2000', '-1'],
    ['2000', 'soon'],
  ])('rejects a fee of %s with a hold of %s', (fee, hold) => {
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', fee);
    vi.stubEnv('PAYOUT_HOLD_DAYS', hold);
    expect(() => readEarningsSettings()).toThrow();
  });

  it('rejects missing settings', () => {
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', undefined);
    vi.stubEnv('PAYOUT_HOLD_DAYS', undefined);
    expect(() => readEarningsSettings()).toThrow();
  });
});
