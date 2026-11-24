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

// A redemption belongs to one order of that student for that course, which
// carries the same code: pending while the redemption is reserved, paid once
// it is redeemed (a refund after delivery keeps it redeemed, so a refunded
// order is fine too).
export const checkCouponRedemptionHasOrder = (
  snapshot: TableSnapshot,
): Violation[] => {
  const orders = new Map(snapshot.orders.map((o) => [o.orderId, o]));
  return snapshot.couponRedemptions.flatMap((r) => {
    const order = orders.get(r.orderId);
    const problems: string[] = [];
    if (!order) {
      problems.push('its order does not exist');
    } else {
      if (order.userId !== r.userId || order.courseId !== r.courseId) {
        problems.push("its order is another student's or course's");
      }
      if (order.couponCode !== r.code) {
        problems.push(
          `its order carries code ${order.couponCode}, not ${r.code}`,
        );
      }
      if (r.status === 'reserved' && order.status !== 'pending') {
        problems.push(`it is reserved but its order is ${order.status}`);
      }
      if (
        r.status === 'redeemed' &&
        order.status !== 'paid' &&
        order.status !== 'refunded'
      ) {
        problems.push(`it is redeemed but its order is ${order.status}`);
      }
    }
    return problems.map((problem) =>
      violation(
        'coupon-redemption-has-order',
        { courseId: r.courseId, code: r.code, userId: r.userId },
        problem,
      ),
    );
  });
};

// A free order (paid, nothing charged, made by a code) is how a code that takes
// the whole price enrols: it has the student's enrolment for the course, which
// names it. An enrolment dropped since still counts; only a missing one, or
// one that has been given another order, does not.
export const checkFreeCouponOrderHasEnrolment = (
  snapshot: TableSnapshot,
): Violation[] => {
  const enrolments = new Map(
    snapshot.enrolments.map((e) => [`${e.userId} ${e.courseId}`, e]),
  );
  return snapshot.orders.flatMap((order) => {
    if (
      order.status !== 'paid' ||
      order.amount !== 0 ||
      order.couponCode === undefined
    ) {
      return [];
    }
    const enrolment = enrolments.get(`${order.userId} ${order.courseId}`);
    const problem = !enrolment
      ? 'a free order made by a code has no enrolment for the student'
      : enrolment.orderId !== order.orderId
        ? 'a free order made by a code is not the order its enrolment names'
        : undefined;
    return problem
      ? [
          violation(
            'free-coupon-order-has-enrolment',
            { orderId: order.orderId },
            problem,
          ),
        ]
      : [];
  });
};

export const COUPONS_CHECKS = [
  {
    name: 'coupon-count-matches-redemptions',
    check: checkCouponCountMatchesRedemptions,
  },
  { name: 'coupon-within-limit', check: checkCouponWithinLimit },
  { name: 'coupon-redemption-shape', check: checkCouponRedemptionShape },
  { name: 'coupon-redemption-has-order', check: checkCouponRedemptionHasOrder },
  {
    name: 'free-coupon-order-has-enrolment',
    check: checkFreeCouponOrderHasEnrolment,
  },
] as const satisfies readonly Check[];
