/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

const couponKey = (c: { courseId: string; code: string }) =>
  `${c.courseId}|${c.code}`;

// A coupon's redeemedCount is the number of its redemption records, reserved
// plus redeemed: the claim and release builders change both in one
// transaction.
export const checkCouponCountMatchesRedemptions = (
  snapshot: TableSnapshot,
): Violation[] => {
  const counts = new Map<string, number>();
  for (const r of snapshot.couponRedemptions) {
    counts.set(couponKey(r), (counts.get(couponKey(r)) ?? 0) + 1);
  }
  return snapshot.coupons
    .filter((c) => c.redeemedCount !== (counts.get(couponKey(c)) ?? 0))
    .map((c) =>
      violation(
        'coupon-count-matches-redemptions',
        { courseId: c.courseId, code: c.code },
        `redeemedCount is ${c.redeemedCount} but it has ${counts.get(couponKey(c)) ?? 0} redemptions`,
      ),
    );
};

// A coupon is within its limit and its value fits its type. A disabled or
// expired coupon with redemptions is fine. Every writer that creates a coupon
// (core-table's helpers and instructor-api's coupon.create) checks the value
// with couponValueProblem, so snapshot.coupons never holds a value it refuses.
export const checkCouponWithinLimit = (snapshot: TableSnapshot): Violation[] =>
  snapshot.coupons.flatMap((c) => {
    const problems: string[] = [];
    if (c.maxRedemptions !== undefined && c.redeemedCount > c.maxRedemptions) {
      problems.push(
        `redeemedCount ${c.redeemedCount} is over maxRedemptions ${c.maxRedemptions}`,
      );
    }
    if (c.type === 'fixed' && !c.currency) {
      problems.push('a fixed coupon has no currency');
    }
    if (
      c.type === 'percent' &&
      !(Number.isInteger(c.value) && c.value >= 1 && c.value <= 100)
    ) {
      problems.push(`percent value ${c.value} is not an integer 1 to 100`);
    }
    if (c.type === 'fixed' && !(Number.isInteger(c.value) && c.value > 0)) {
      problems.push(`fixed value ${c.value} is not an integer above 0`);
    }
    return problems.map((problem) =>
      violation(
        'coupon-within-limit',
        { courseId: c.courseId, code: c.code },
        problem,
      ),
    );
  });

// A redemption belongs to a coupon, and its reservedUntil is there exactly
// while it is reserved.
export const checkCouponRedemptionShape = (
  snapshot: TableSnapshot,
): Violation[] => {
  const coupons = new Set(snapshot.coupons.map(couponKey));
  return snapshot.couponRedemptions.flatMap((r) => {
    const problems: string[] = [];
    if (!coupons.has(couponKey(r))) problems.push('the coupon does not exist');
    if (r.status === 'reserved' && r.reservedUntil === undefined) {
      problems.push('it is reserved but has no reservedUntil');
    }
    if (r.status === 'redeemed' && r.reservedUntil !== undefined) {
      problems.push('it is redeemed but still has reservedUntil');
    }
    return problems.map((problem) =>
      violation(
        'coupon-redemption-shape',
        { courseId: r.courseId, code: r.code, userId: r.userId },
        problem,
      ),
    );
  });
};

export const COUPONS_CHECKS = [
  {
    name: 'coupon-count-matches-redemptions',
    check: checkCouponCountMatchesRedemptions,
  },
  { name: 'coupon-within-limit', check: checkCouponWithinLimit },
  { name: 'coupon-redemption-shape', check: checkCouponRedemptionShape },
] as const satisfies readonly Check[];
