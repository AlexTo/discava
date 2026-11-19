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
  const addRedemption = (
    extra: Partial<TableSnapshot['couponRedemptions'][number]> = {},
  ) => {
    table.couponRedemptions.push({
      courseId: 'c1',
      code: 'SPRING-20',
      userId: 'student-1',
      status: 'reserved',
      reservedUntil: T,
      ...extra,
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
});
