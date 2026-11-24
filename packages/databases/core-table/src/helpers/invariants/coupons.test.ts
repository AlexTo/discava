/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { checkTableInvariants } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { consistentTable, T, testHelpers } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { broken, expectOnly } = testHelpers(() => table);

describe('coupons', () => {
  const addCoupon = (extra: Partial<TableSnapshot['coupons'][number]> = {}) => {
    table.coupons.push({
      courseId: 'c1',
      code: 'SPRING-20',
      type: 'percent',
      value: 20,
      redeemedCount: 0,
      ...extra,
    });
  };
  // The order a redemption belongs to. A redeemed redemption's order is
  // refunded, which keeps the checks on paid orders and their enrolments out
  // of it; the refund after delivery leaves the redemption redeemed.
  const addOrder = (extra: Partial<TableSnapshot['orders'][number]> = {}) => {
    // The window the connection keeps open covers every order.
    table.paymentConnections = [
      {
        status: 'active',
        mode: 'test',
        accountId: 'acct_1',
        accountName: 'Account',
        keyLast4: 'wxyz',
        webhookEndpointId: 'we_1',
        webhookUrl: 'https://example.com/stripe/webhook',
        latestCheckoutExpiresAt: T,
        revision: 1,
        changedAt: T,
      },
    ];
    table.orders.push({
      orderId: 'order-student-1',
      userId: 'student-1',
      courseId: 'c1',
      accountId: 'acct_1',
      mode: 'test',
      listAmount: 1999,
      amount: 1499,
      currency: 'USD',
      discountAmount: 500,
      couponCode: 'SPRING-20',
      couponType: 'fixed',
      couponValue: 500,
      status: 'pending',
      expiresAt: T,
      createdAt: T,
      ...extra,
    });
  };
  const addRedemption = (
    extra: Partial<TableSnapshot['couponRedemptions'][number]> = {},
    order: Partial<TableSnapshot['orders'][number]> | false = {},
  ) => {
    const redemption = {
      courseId: 'c1',
      code: 'SPRING-20',
      userId: 'student-1',
      orderId: `order-${extra.userId ?? 'student-1'}`,
      status: 'reserved' as const,
      reservedUntil: T,
      ...extra,
    };
    table.couponRedemptions.push(redemption);
    if (order === false) return;
    const redeemed = redemption.status === 'redeemed';
    addOrder({
      orderId: redemption.orderId,
      userId: redemption.userId,
      courseId: redemption.courseId,
      couponCode: redemption.code,
      ...(redeemed
        ? {
            status: 'refunded',
            refundedAt: T,
            refundReason: 'requested',
            paidAt: T,
          }
        : {}),
      ...order,
    });
  };

  it('finds nothing wrong with a coupon and its redemptions', () => {
    addCoupon({ redeemedCount: 2, maxRedemptions: 2 });
    addRedemption();
    addRedemption({
      userId: 'student-2',
      status: 'redeemed',
      reservedUntil: undefined,
    });
    expect(checkTableInvariants(table)).toEqual([]);
  });

  // Nothing in the coupon records is a student's work in a course.
  it('trips none of the student-record or activity-count checks', () => {
    addCoupon({ redeemedCount: 1 });
    addRedemption({ userId: 'not-enrolled' });
    const { invariants } = broken();
    expect(invariants).toEqual([]);
  });

  describe('coupon-count-matches-redemptions', () => {
    it('reports a count higher than the records', () => {
      addCoupon({ redeemedCount: 2 });
      addRedemption();
      expectOnly('coupon-count-matches-redemptions', /is 2 but it has 1/);
    });

    it('reports a count lower than the records', () => {
      addCoupon({ redeemedCount: 0 });
      addRedemption();
      expectOnly('coupon-count-matches-redemptions', /is 0 but it has 1/);
    });

    it("does not count another course's redemptions of the same code", () => {
      addCoupon({ redeemedCount: 0 });
      addRedemption({ courseId: 'other' });
      expect(
        checkTableInvariants(table).filter(
          (v) => v.invariant === 'coupon-count-matches-redemptions',
        ),
      ).toEqual([]);
    });
  });

  describe('coupon-within-limit', () => {
    it('reports a count above the limit', () => {
      addCoupon({ redeemedCount: 2, maxRedemptions: 1 });
      addRedemption();
      addRedemption({ userId: 'student-2' });
      expectOnly('coupon-within-limit', /over maxRedemptions 1/);
    });

    it('reports a fixed coupon without a currency', () => {
      addCoupon({ type: 'fixed', value: 500 });
      expectOnly('coupon-within-limit', /no currency/);
    });

    it.each([0, 101, 12.5])('reports a percent value of %s', (value) => {
      addCoupon({ value });
      expectOnly('coupon-within-limit', /not an integer 1 to 100/);
    });

    it.each([0, -5, 1.5])('reports a fixed value of %s', (value) => {
      addCoupon({ type: 'fixed', currency: 'usd', value });
      expectOnly('coupon-within-limit', /not an integer above 0/);
    });

    it('accepts a fixed coupon with a currency and a percent of 1 or 100', () => {
      addCoupon({
        type: 'fixed',
        currency: 'usd',
        value: 500,
        code: 'FIXED',
      });
      addCoupon({ value: 1, code: 'ONE' });
      addCoupon({ value: 100, code: 'ALL' });
      expect(checkTableInvariants(table)).toEqual([]);
    });
  });

  describe('coupon-redemption-shape', () => {
    it('reports a redemption without its coupon', () => {
      addRedemption();
      expectOnly('coupon-redemption-shape', /coupon does not exist/);
    });

    it('reports reserved without reservedUntil', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({ reservedUntil: undefined });
      expectOnly('coupon-redemption-shape', /no reservedUntil/);
    });

    it('reports redeemed with reservedUntil', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({ status: 'redeemed' });
      expectOnly('coupon-redemption-shape', /still has reservedUntil/);
    });
  });

  describe('coupon-redemption-has-order', () => {
    it('reports a redemption with no order', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({}, false);
      expectOnly('coupon-redemption-has-order', /order does not exist/);
    });

    it('reports an order of another student or course, or with another code', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({}, { userId: 'student-2' });
      expectOnly('coupon-redemption-has-order', /another student/);
    });

    it('reports an order with another code', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({}, { couponCode: 'OTHER' });
      expectOnly('coupon-redemption-has-order', /carries code OTHER/);
    });

    it('reports a reserved redemption whose order is paid', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({}, { status: 'paid', paidAt: T });
      const found = checkTableInvariants(table).filter(
        (v) => v.invariant === 'coupon-redemption-has-order',
      );
      expect(found.map((v) => v.message)).toEqual([
        'it is reserved but its order is paid',
      ]);
    });

    it('reports a redeemed redemption whose order is pending', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption(
        { status: 'redeemed', reservedUntil: undefined },
        { status: 'pending', paidAt: undefined, refundedAt: undefined },
      );
      expectOnly(
        'coupon-redemption-has-order',
        /redeemed but its order is pending/,
      );
    });

    it('accepts a redeemed redemption whose order was refunded', () => {
      addCoupon({ redeemedCount: 1 });
      addRedemption({ status: 'redeemed', reservedUntil: undefined });
      expect(
        checkTableInvariants(table).filter(
          (v) => v.invariant === 'coupon-redemption-has-order',
        ),
      ).toEqual([]);
    });
  });
  describe('free-coupon-order-has-enrolment', () => {
    // A paid order of nothing, made by a code that took the whole price, with
    // its redemption and the enrolment it created.
    const addFreeOrder = (
      enrolment: Partial<TableSnapshot['enrolments'][number]> | false = {},
    ) => {
      addCoupon({ redeemedCount: 1, type: 'percent', value: 100 });
      addRedemption(
        {
          userId: 'student',
          orderId: 'order-free',
          status: 'redeemed',
          reservedUntil: undefined,
        },
        {
          orderId: 'order-free',
          userId: 'student',
          amount: 0,
          discountAmount: 1999,
          couponType: 'percent',
          couponValue: 100,
          status: 'paid',
          paidAt: T,
          refundedAt: undefined,
          refundReason: undefined,
        },
      );
      table.enrolments = table.enrolments.filter((e) => e.userId !== 'student');
      if (enrolment === false) return;
      table.enrolments.push({
        courseId: 'c1',
        userId: 'student',
        status: 'active',
        progressPercent: 0,
        createdAt: T,
        orderId: 'order-free',
        ...enrolment,
      } as TableSnapshot['enrolments'][number]);
    };
    const free = () =>
      checkTableInvariants(table).filter(
        (v) => v.invariant === 'free-coupon-order-has-enrolment',
      );

    it('accepts a free order with its enrolment', () => {
      addFreeOrder();
      expect(free()).toEqual([]);
    });

    it('reports a free order with no enrolment', () => {
      addFreeOrder(false);
      expect(free().map((v) => v.message)).toEqual([
        'a free order made by a code has no enrolment for the student',
      ]);
    });

    it('reports a free order whose student is enrolled in another course only', () => {
      addFreeOrder({ courseId: 'c2' });
      expect(free()).toHaveLength(1);
    });

    it('reports an enrolment that names another order', () => {
      addFreeOrder({ orderId: 'order-other' });
      expect(free()).toHaveLength(1);
    });

    it('accepts a free order whose enrolment was later dropped', () => {
      addFreeOrder({ status: 'dropped' });
      expect(free()).toEqual([]);
    });
  });
});
