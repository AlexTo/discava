/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { checkTableInvariants, consistentTable, T } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});

describe('payments: price, orders and the connection', () => {
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);
  const PRICED = '2026-01-05T00:00:00.000Z';
  const LATER = '2026-01-06T00:00:00.000Z';
  const order = (overrides: Partial<TableSnapshot['orders'][number]> = {}) => ({
    orderId: 'o1',
    userId: 'student',
    courseId: 'c1',
    accountId: 'acct_1',
    listAmount: 1999,
    amount: 1999,
    currency: 'USD',
    status: 'paid' as const,
    expiresAt: '2026-01-05T01:00:00.000Z',
    checkoutSessionId: 'cs_1',
    paymentIntentId: 'pi_1',
    paidAt: '2026-01-05T00:10:00.000Z',
    createdAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  });
  const connection = (
    overrides: Partial<TableSnapshot['paymentConnections'][number]> = {},
  ) => ({
    status: 'active' as const,
    mode: 'test' as const,
    accountId: 'acct_1',
    accountName: 'Account',
    keyLast4: 'wxyz',
    webhookEndpointId: 'we_1',
    webhookUrl: 'https://example.com/stripe/webhook',
    latestCheckoutExpiresAt: '2026-01-05T01:00:00.000Z',
    revision: 2,
    changedAt: '2026-01-04T00:00:00.000Z',
    ...overrides,
  });
  // A priced course whose student paid for it.
  const paidTable = () => {
    table = consistentTable();
    Object.assign(table.courses[0], {
      priceAmount: 1999,
      pricedAt: PRICED,
    });
    table.orders = [order()];
    table.enrolments[0].orderId = 'o1';
    table.enrolments[0].createdAt = '2026-01-05T00:10:00.000Z';
    table.paymentConnections = [connection()];
    return table;
  };

  it('accepts a paid, priced course', () => {
    paidTable();
    expect(checkTableInvariants(table)).toEqual([]);
  });

  describe('price-shape', () => {
    it.each([
      [{ priceAmount: 99 }, /priceAmount 99/],
      [{ priceAmount: 1_000_001, pricedAt: PRICED }, /priceAmount 1000001/],
      [{ priceAmount: 150.5, pricedAt: PRICED }, /priceAmount 150.5/],
      [{ priceCurrency: 'JPY' }, /priceCurrency JPY/],
      [{ priceAmount: 500 }, /pricedAt is not set/],
      [{ pricedAt: PRICED }, /pricedAt is set/],
    ])('reports %j', (change, message) => {
      Object.assign(table.courses[0], change);
      expect(violationsOf('price-shape').map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it.each([0, 100, 1_000_000])('accepts %i', (priceAmount) => {
      Object.assign(table.courses[0], {
        priceAmount,
        pricedAt: priceAmount > 0 ? PRICED : undefined,
      });
      expect(violationsOf('price-shape')).toEqual([]);
    });
  });

  describe('order-shape', () => {
    it.each([
      [{ listAmount: 99 }, /listAmount 99/],
      [{ listAmount: 1_000_001 }, /listAmount/],
      [{ amount: 2000 }, /amount 2000/],
      [{ amount: -1 }, /amount -1/],
      [{ currency: 'JPY' }, /currency JPY/],
      [{ accountId: '' }, /accountId is not set/],
      [{ paidAt: undefined }, /paidAt is not set/],
      [{ paymentIntentId: undefined }, /no payment intent/],
      [
        {
          status: 'refunded',
          refundedAt: undefined,
          refundReason: 'requested',
        },
        /refundedAt is not set/,
      ],
      [
        { status: 'refunded', refundedAt: LATER, refundReason: undefined },
        /refund reason/,
      ],
      [
        { status: 'refunded', refundedAt: LATER, refundReason: 'other' },
        /refund reason other is not known/,
      ],
      [
        {
          status: 'refunded',
          refundedAt: LATER,
          refundReason: 'requested',
          paidAt: undefined,
        },
        /paidAt is not set/,
      ],
      [{ refundedAmount: 2000 }, /refundedAmount is more/],
      [{ status: 'pending' }, /paidAt is set/],
      [{ status: 'expired' }, /paidAt is set/],
    ])('reports %j', (change, message) => {
      paidTable();
      Object.assign(table.orders[0], change);
      expect(violationsOf('order-shape').map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
    });

    it('reports a checkout session on two orders', () => {
      paidTable();
      table.orders.push(
        order({ orderId: 'o2', status: 'expired', paidAt: undefined }),
      );
      expect(violationsOf('order-shape')).toHaveLength(2);
    });

    it.each(['mismatch', 'duplicate', 'unavailable'] as const)(
      'accepts a refund for %s and a free-priced paid order of amount 0 needs no payment intent',
      (refundReason) => {
        paidTable();
        table.enrolments[0].orderId = undefined;
        Object.assign(table.orders[0], {
          status: 'refunded',
          refundedAt: LATER,
          refundedAmount: 1999,
          refundReason,
        });
        table.enrolments[0].status = 'dropped';
        expect(violationsOf('order-shape')).toEqual([]);
      },
    );

    it('does not report a pending order past its expiry', () => {
      paidTable();
      table.enrolments[0].orderId = undefined;
      table.enrolments[0].createdAt = T;
      Object.assign(table.orders[0], {
        status: 'pending',
        paidAt: undefined,
        paymentIntentId: undefined,
        expiresAt: '2026-01-05T01:00:00.000Z',
      });
      expect(checkTableInvariants(table)).toEqual([]);
    });
  });

  describe('paid-order-has-enrolment', () => {
    it('reports a paid order with no enrolment, a dropped one, or one for another order', () => {
      paidTable();
      table.enrolments = [];
      expect(violationsOf('paid-order-has-enrolment')[0]?.message).toMatch(
        /no enrolment/,
      );

      paidTable();
      table.enrolments[0].status = 'dropped';
      expect(violationsOf('paid-order-has-enrolment')[0]?.message).toMatch(
        /dropped/,
      );

      paidTable();
      table.enrolments[0].orderId = 'o9';
      expect(
        violationsOf('paid-order-has-enrolment').map((v) => v.message),
      ).toContainEqual(expect.stringMatching(/another order/));
    });

    it('reports two paid orders for one student and course', () => {
      paidTable();
      table.orders.push(order({ orderId: 'o2', checkoutSessionId: 'cs_2' }));
      expect(
        violationsOf('paid-order-has-enrolment').map((v) => v.message),
      ).toContainEqual(expect.stringMatching(/another paid order/));
    });
  });

  describe('enrolment-order-matches', () => {
    it('reports an orderId naming a missing, other-student or other-course order', () => {
      paidTable();
      table.enrolments[0].orderId = 'missing';
      expect(violationsOf('enrolment-order-matches')[0]?.message).toMatch(
        /does not exist/,
      );
      paidTable();
      table.orders[0].userId = 'other';
      expect(violationsOf('enrolment-order-matches')[0]?.message).toMatch(
        /another student or course/,
      );
      paidTable();
      table.orders[0].courseId = 'c2';
      expect(violationsOf('enrolment-order-matches')[0]?.message).toMatch(
        /another student or course/,
      );
    });

    it.each(['duplicate', 'unavailable', 'mismatch'] as const)(
      'reports an order refunded for %s as an enrolment’s order',
      (refundReason) => {
        paidTable();
        Object.assign(table.orders[0], {
          status: 'refunded',
          refundedAt: LATER,
          refundedAmount: 1999,
          refundReason,
        });
        table.enrolments[0].status = 'dropped';
        expect(violationsOf('enrolment-order-matches')).toHaveLength(1);
      },
    );

    it('accepts a refunded-on-request order whose enrolment is dropped, and reports one still active', () => {
      paidTable();
      Object.assign(table.orders[0], {
        status: 'refunded',
        refundedAt: LATER,
        refundedAmount: 1999,
        refundReason: 'requested',
      });
      table.enrolments[0].status = 'dropped';
      expect(violationsOf('enrolment-order-matches')).toEqual([]);
      table.enrolments[0].status = 'active';
      expect(violationsOf('enrolment-order-matches')).toHaveLength(1);
    });
  });

  describe('paid-course-enrolment-paid', () => {
    it('reports an unpaid enrolment created after pricedAt plus 10 seconds', () => {
      paidTable();
      table.enrolments[0].orderId = undefined;
      table.orders = [];
      table.enrolments[0].createdAt = '2026-01-05T00:00:11.000Z';
      expect(violationsOf('paid-course-enrolment-paid')).toHaveLength(1);
    });

    it('accepts an unpaid enrolment created before pricedAt, or within 10 seconds', () => {
      paidTable();
      table.enrolments[0].orderId = undefined;
      table.orders = [];
      table.enrolments[0].createdAt = T;
      expect(violationsOf('paid-course-enrolment-paid')).toEqual([]);
      table.enrolments[0].createdAt = '2026-01-05T00:00:10.000Z';
      expect(violationsOf('paid-course-enrolment-paid')).toEqual([]);
    });

    it('accepts a refunded student restored for free, in a free course and one priced again', () => {
      paidTable();
      Object.assign(table.orders[0], {
        status: 'refunded',
        refundedAt: LATER,
        refundedAmount: 1999,
        refundReason: 'requested',
      });
      table.enrolments[0].orderId = undefined;
      table.enrolments[0].createdAt = LATER;
      expect(violationsOf('paid-course-enrolment-paid')).toEqual([]);
      expect(violationsOf('enrolment-order-matches')).toEqual([]);
      expect(violationsOf('paid-order-has-enrolment')).toEqual([]);
      // In a free course nothing applies.
      Object.assign(table.courses[0], { priceAmount: 0, pricedAt: undefined });
      expect(violationsOf('paid-course-enrolment-paid')).toEqual([]);
    });

    it('does not report a course set back to free with paid orders', () => {
      paidTable();
      Object.assign(table.courses[0], { priceAmount: 0, pricedAt: undefined });
      expect(checkTableInvariants(table)).toEqual([]);
    });
  });

  describe('orders are not student activity', () => {
    it('does not count a student whose only record is an order', () => {
      table.users.push({ userId: 'buyer' });
      table.orders = [
        order({
          userId: 'buyer',
          status: 'expired',
          paidAt: undefined,
          paymentIntentId: undefined,
        }),
      ];
      table.paymentConnections = [connection()];
      const names = checkTableInvariants(table).map((v) => v.invariant);
      expect(names).not.toContain('activity-count-matches-students');
      expect(names.filter((n) => n.startsWith('student-records-'))).toEqual([]);
    });
  });

  describe('payment-connection-shape', () => {
    it.each([
      [{ status: 'odd' }, /status odd/],
      [{ revision: 0 }, /revision 0/],
      [{ revision: 1.5 }, /revision 1.5/],
      [{ accountId: undefined }, /accountId is not set/],
      [{ accountName: undefined }, /accountName is not set/],
      [{ keyLast4: 'abc' }, /keyLast4/],
      [{ mode: undefined }, /mode is not set/],
      [{ webhookEndpointId: undefined }, /webhook registration/],
      [{ webhookUrl: undefined }, /webhook registration/],
      [{ status: 'changing', previousStatus: 'active' }, /leaseUntil/],
    ])('reports %j', (change, message) => {
      table.paymentConnections = [connection(change as never)];
      expect(
        violationsOf('payment-connection-shape').map((v) => v.message),
      ).toContainEqual(expect.stringMatching(message));
    });

    it('reports a second record', () => {
      table.paymentConnections = [connection(), connection()];
      expect(violationsOf('payment-connection-shape')[0]?.message).toMatch(
        /2 connection records/,
      );
    });

    it('accepts a first connection in progress, and a disconnected record', () => {
      table.paymentConnections = [
        {
          status: 'changing',
          mode: 'test',
          previousStatus: 'disconnected',
          leaseUntil: LATER,
          revision: 1,
        },
      ];
      expect(violationsOf('payment-connection-shape')).toEqual([]);
      table.paymentConnections = [
        { status: 'disconnected', mode: 'test', revision: 4 },
      ];
      expect(violationsOf('payment-connection-shape')).toEqual([]);
    });

    it('does not count the connection or its audit rows as student activity', () => {
      table.paymentConnections = [connection()];
      table.paymentChanges = [
        {
          changeId: 'ch1',
          kind: 'connected',
          byUserId: 'admin',
          byName: 'Carol',
          at: T,
          keyLast4: 'wxyz',
        },
      ];
      expect(checkTableInvariants(table)).toEqual([]);
    });
  });

  describe('checkout-window-covers-orders', () => {
    it('reports an order that expires after the record’s latest', () => {
      paidTable();
      table.orders[0].expiresAt = '2026-01-05T02:00:00.000Z';
      expect(violationsOf('checkout-window-covers-orders')).toHaveLength(1);
    });

    it('reports an order with no record, and a record with no latest', () => {
      paidTable();
      table.paymentConnections = [];
      expect(violationsOf('checkout-window-covers-orders')[0]?.message).toMatch(
        /no connection record/,
      );
      table.paymentConnections = [
        connection({ latestCheckoutExpiresAt: undefined }),
      ];
      expect(violationsOf('checkout-window-covers-orders')).toHaveLength(1);
    });

    it('accepts a disconnected record that keeps its window', () => {
      paidTable();
      table.paymentConnections = [
        {
          status: 'disconnected',
          mode: 'test',
          revision: 4,
          latestCheckoutExpiresAt: '2026-01-05T01:00:00.000Z',
        },
      ];
      expect(violationsOf('checkout-window-covers-orders')).toEqual([]);
    });
  });

  describe('order-account-known', () => {
    it('reports an order with no account', () => {
      paidTable();
      table.orders[0].accountId = '';
      expect(violationsOf('order-account-known')[0]?.message).toMatch(
        /no accountId/,
      );
    });

    it('reports a new order naming another account than the active record', () => {
      paidTable();
      table.orders[0].accountId = 'acct_other';
      expect(violationsOf('order-account-known')).toHaveLength(1);
    });

    it('accepts an order from an earlier connection', () => {
      paidTable();
      table.orders[0].accountId = 'acct_other';
      table.paymentConnections = [
        connection({ changedAt: '2026-01-05T12:00:00.000Z' }),
      ];
      expect(violationsOf('order-account-known')).toEqual([]);
    });
  });

  describe('payment-change-shape', () => {
    const row = (overrides = {}) => ({
      changeId: 'ch1',
      kind: 'connected' as const,
      byUserId: 'admin',
      byName: 'Carol',
      at: T,
      keyLast4: 'wxyz',
      ...overrides,
    });

    it('accepts a row with four key characters', () => {
      table.paymentChanges = [row()];
      expect(violationsOf('payment-change-shape')).toEqual([]);
    });

    it('reports a row that holds a full key, in the last-four field or elsewhere', () => {
      table.paymentChanges = [row({ keyLast4: 'sk_test_0123456789abcdef' })];
      const messages = violationsOf('payment-change-shape').map(
        (v) => v.message,
      );
      expect(messages).toContainEqual(expect.stringMatching(/more than four/));
      expect(messages).toContainEqual(
        expect.stringMatching(/key or signing secret/),
      );
      table.paymentChanges = [row({ byName: 'whsec_abcdef123456' })];
      expect(violationsOf('payment-change-shape')).toHaveLength(1);
    });

    it('reports a missing who, when or kind', () => {
      table.paymentChanges = [row({ byName: '' }), row({ kind: 'odd' })];
      expect(violationsOf('payment-change-shape')).toHaveLength(2);
    });
  });
});
