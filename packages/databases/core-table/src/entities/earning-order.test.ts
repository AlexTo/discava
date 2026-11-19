/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createEarningOrderEntity } from './earning-order.js';

let earningOrder: Awaited<ReturnType<typeof createEarningOrderEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  earningOrder = await createEarningOrderEntity();
});

const full = {
  orderId: 'order-1',
  courseId: 'course-1',
  currency: 'USD',
  accountId: 'acct_1',
  mode: 'test' as const,
  grossMinor: 1000,
  discountMinor: 200,
  paidMinor: 800,
  feeMinor: 160,
  feeBasisPoints: 2000,
  instructorIds: ['a', 'b'],
  refundedMinor: 0,
};

type Params = { Item: Record<string, unknown> };

describe('earningOrder', () => {
  it('accepts a complete record', () => {
    const { Item } = earningOrder.create(full).params() as Params;
    expect(Item.instructorIds).toEqual(['a', 'b']);
  });

  it.each(Object.keys(full))('refuses a record without %s', (field) => {
    const record: Record<string, unknown> = { ...full };
    delete record[field];
    expect(() => earningOrder.create(record as never).params()).toThrow();
  });

  it('refuses a mode outside the set', () => {
    expect(() =>
      earningOrder.create({ ...full, mode: 'odd' as never }).params(),
    ).toThrow();
  });

  it.each([
    'grossMinor',
    'discountMinor',
    'paidMinor',
    'feeMinor',
    'feeBasisPoints',
    'refundedMinor',
  ])('refuses a non-integer %s', (field) => {
    expect(() =>
      earningOrder.create({ ...full, [field]: 0.5 } as never).params(),
    ).toThrow();
  });

  it('refuses a negative refunded total', () => {
    expect(() =>
      earningOrder.create({ ...full, refundedMinor: -1 }).params(),
    ).toThrow();
  });

  it('keys by order under a constant sort key, with no index', () => {
    const { Item } = earningOrder.create(full).params() as Params;
    expect(Item.pk).toContain('order-1');
    expect(Item.sk).toBe('earning');
    expect(Item).not.toHaveProperty('gsi1pk');
  });

  it('only lets refundedMinor change', () => {
    expect(() =>
      earningOrder
        .patch({ orderId: 'order-1' })
        .set({ refundedMinor: 400 })
        .params(),
    ).not.toThrow();
    expect(() =>
      earningOrder
        .patch({ orderId: 'order-1' })
        .set({ paidMinor: 1 } as never)
        .params(),
    ).toThrow();
    expect(() =>
      earningOrder
        .patch({ orderId: 'order-1' })
        .set({ instructorIds: ['c'] } as never)
        .params(),
    ).toThrow();
  });
});
