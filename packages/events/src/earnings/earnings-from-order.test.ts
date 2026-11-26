/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isSale,
  refundInput,
  refundReversalInput,
  saleInput,
} from './earnings-from-order.js';

const order = (overrides: Record<string, unknown> = {}) => ({
  __edb_e__: 'order',
  orderId: 'o1',
  courseId: 'c1',
  userId: 'buyer-1',
  accountId: 'acct_1',
  mode: 'test',
  currency: 'usd',
  listAmount: 1000,
  amount: 800,
  status: 'paid',
  paidAt: '2026-11-19T10:00:00.000Z',
  updatedAt: '2026-11-19T10:00:01.000Z',
  ...overrides,
});

describe('isSale', () => {
  it('is true for a paid order', () => {
    expect(isSale(order())).toBe(true);
  });

  it('is true for an order refunded on request', () => {
    expect(
      isSale(order({ status: 'refunded', refundReason: 'requested' })),
    ).toBe(true);
  });

  it.each(['duplicate', 'unavailable', 'mismatch'])(
    'is false for an order refunded as %s, though it has paidAt',
    (refundReason) => {
      expect(isSale(order({ status: 'refunded', refundReason }))).toBe(false);
    },
  );

  it.each(['pending', 'expired'])('is false for a %s order', (status) => {
    expect(isSale(order({ status, paidAt: undefined }))).toBe(false);
  });

  it('is false for an order that cost nothing', () => {
    expect(isSale(order({ amount: 0 }))).toBe(false);
  });
});

describe('saleInput', () => {
  it('takes the list price as gross and the charge as paid', () => {
    const input = saleInput(order());
    expect(input).toMatchObject({
      listAmount: 1000,
      amount: 800,
      currency: 'usd',
      courseId: 'c1',
      accountId: 'acct_1',
      mode: 'test',
      paidAt: '2026-11-19T10:00:00.000Z',
    });
    expect(input.listAmount - input.amount).toBe(200);
  });

  it('does not carry the buyer', () => {
    expect(JSON.stringify(saleInput(order()))).not.toContain('buyer-1');
    expect(
      JSON.stringify(refundInput(order({ refundedAmount: 5 }))),
    ).not.toContain('buyer-1');
  });
});

describe('refundReversalInput', () => {
  it('gives a paid order with refundFailedAt and nothing refunded, at that time', () => {
    expect(
      refundReversalInput(
        order({ refundFailedAt: '2026-11-21T00:00:00.000Z' }),
      ),
    ).toEqual({ orderId: 'o1', occurredAt: '2026-11-21T00:00:00.000Z' });
  });

  it('gives nothing for an order refunded, never failed, or still partly refunded', () => {
    expect(refundReversalInput(order())).toBeUndefined();
    expect(
      refundReversalInput(
        order({
          status: 'refunded',
          refundReason: 'requested',
          refundedAmount: 800,
          refundFailedAt: '2026-11-21T00:00:00.000Z',
        }),
      ),
    ).toBeUndefined();
    expect(
      refundReversalInput(
        order({
          refundedAmount: 300,
          refundFailedAt: '2026-11-21T00:00:00.000Z',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('refundInput', () => {
  it('gives the refunded total at the order refundedAt when refunded', () => {
    expect(
      refundInput(
        order({
          status: 'refunded',
          refundReason: 'requested',
          refundedAmount: 800,
          refundedAt: '2026-11-20T00:00:00.000Z',
        }),
      ),
    ).toEqual({
      orderId: 'o1',
      refundedTotal: 800,
      occurredAt: '2026-11-20T00:00:00.000Z',
    });
  });

  it('gives a partly refunded paid order its total and updatedAt', () => {
    expect(refundInput(order({ refundedAmount: 300 }))).toEqual({
      orderId: 'o1',
      refundedTotal: 300,
      occurredAt: '2026-11-19T10:00:01.000Z',
    });
  });

  it('gives nothing when nothing was refunded', () => {
    expect(refundInput(order())).toBeUndefined();
    expect(refundInput(order({ refundedAmount: 0 }))).toBeUndefined();
  });
});
