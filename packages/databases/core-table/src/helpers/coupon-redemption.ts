/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { expireOrderWrites, type OrderRecord } from './order.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

// A student's use of a coupon. Every procedure or handler that starts,
// completes or abandons one builds its transaction from these helpers, the
// only writers of a coupon's redeemedCount and of couponRedemption records, so
// the rules other writers rely on are kept in one place (#71):
// - redeemedCount is the number of the coupon's redemption records, reserved
//   plus redeemed, and never goes past maxRedemptions;
// - a claim needs the coupon enabled, not expired and under its limit;
// - a student has one redemption per code, and releasing one twice lowers
//   the count once.
// A failed condition cancels the whole transaction; the caller reads again to
// give the precise refusal (see couponStatus and COUPON_REFUSALS).

/** The messages a refused code is answered with, by preview and checkout. */
export const COUPON_REFUSALS = {
  invalid: 'This code is not valid for this course',
  disabled: 'This code has been turned off',
  expired: 'This code has expired',
  usedUp: 'This code has been used the maximum number of times',
  alreadyUsed: 'You have already used this code',
  alreadyEnrolled: 'You are already enrolled in this course',
  belowMinimum: 'This code leaves a price too low to pay for',
} as const;

export type CouponStatus = 'disabled' | 'expired' | 'used up' | 'active';

/** What an instructor sees, derived and never stored. Disabled beats expired. */
export const couponStatus = (
  coupon: {
    enabled: boolean;
    expiresAt?: string;
    maxRedemptions?: number;
    redeemedCount: number;
  },
  now: string,
): CouponStatus => {
  if (!coupon.enabled) return 'disabled';
  if (coupon.expiresAt !== undefined && coupon.expiresAt <= now) {
    return 'expired';
  }
  if (
    coupon.maxRedemptions !== undefined &&
    coupon.redeemedCount >= coupon.maxRedemptions
  ) {
    return 'used up';
  }
  return 'active';
};

export interface CouponClaim {
  coupon: { courseId: string; code: string };
  userId: string;
  orderId: string;
  /** `reserved` while a checkout can still be paid; `redeemed` for a zero total. */
  status: 'reserved' | 'redeemed';
  /** An ISO instant: the time the coupon is judged against. */
  now: string;
  /** Required for `reserved`: the session's expiry plus 5 minutes. */
  reservedUntil?: string;
}

/**
 * Raises the coupon's redeemedCount, if it is enabled, unexpired and under
 * its limit, and creates the student's redemption, which fails if they already
 * have one for the code.
 */
export const claimCouponWrites = (
  { coupon: couponEntity, couponRedemption }: TransactionEntities,
  { coupon, userId, orderId, status, now, reservedUntil }: CouponClaim,
): ReturnType<TransactionWrites> => {
  if (status === 'reserved' && reservedUntil === undefined) {
    throw new Error('A reserved redemption needs reservedUntil');
  }
  const { courseId, code } = coupon;
  return [
    couponEntity
      .patch({ courseId, code })
      .add({ redeemedCount: 1 })
      .where(
        (attr, op) =>
          `${op.eq(attr.enabled, true)} AND (${op.notExists(attr.expiresAt)} OR ${op.gt(attr.expiresAt, now)}) AND (${op.notExists(attr.maxRedemptions)} OR ${op.name(attr.redeemedCount)} < ${op.name(attr.maxRedemptions)})`,
      )
      .commit(),
    couponRedemption
      .create({
        courseId,
        code,
        userId,
        orderId,
        status,
        ...(status === 'reserved' ? { reservedUntil } : {}),
      })
      .commit(),
  ];
};

/**
 * Reserved becomes redeemed. Conditional on `reserved`, so it changes nothing
 * for a redemption already redeemed or released.
 */
export const confirmCouponWrites = (
  { couponRedemption }: TransactionEntities,
  key: { courseId: string; code: string; userId: string },
): ReturnType<TransactionWrites> => [
  couponRedemption
    .patch(key)
    .set({ status: 'redeemed' })
    .remove(['reservedUntil'])
    .where((attr, op) => op.eq(attr.status, 'reserved'))
    .commit(),
];

/**
 * Deletes a reserved redemption and lowers the count. Conditional on
 * `reserved`, so a second release (or one after confirm) cancels instead of
 * lowering the count again.
 */
export const releaseCouponWrites = (
  { coupon, couponRedemption }: TransactionEntities,
  key: { courseId: string; code: string; userId: string },
): ReturnType<TransactionWrites> => [
  couponRedemption
    .delete(key)
    .where((attr, op) => op.eq(attr.status, 'reserved'))
    .commit(),
  coupon
    .patch({ courseId: key.courseId, code: key.code })
    .subtract({ redeemedCount: 1 })
    .where((attr, op) => op.gt(attr.redeemedCount, 0))
    .commit(),
];

/**
 * Frees the reservations of one code whose `reservedUntil` has passed: for
 * each, in one transaction, the order's move from `pending` to `expired` and
 * the release, so a replayed or racing call changes nothing. A redeemed
 * redemption is never touched. Returns how many it released.
 *
 * The clock alone does not say the order cannot be paid: a student can pay
 * just before the session ends while Stripe's paid event is still on its way.
 * `canRelease` is asked, with the order, before each release, and the
 * reservation is kept when it answers false (the caller checks the session
 * with Stripe), so the late event still finds a pending order to settle.
 */
export const reclaimExpiredReservations = async ({
  coreTable,
  courseId,
  code,
  now,
  canRelease,
}: {
  coreTable: CoreTable;
  courseId: string;
  code: string;
  now: string;
  canRelease?: (order: OrderRecord) => Promise<boolean>;
}): Promise<number> => {
  const { data } = await coreTable.entities.couponRedemption.query
    .primary({ courseId, code })
    .go({ pages: 'all' });
  let released = 0;
  for (const redemption of data) {
    if (
      redemption.status !== 'reserved' ||
      redemption.reservedUntil === undefined ||
      redemption.reservedUntil > now
    ) {
      continue;
    }
    if (canRelease) {
      const { data: order } = await coreTable.entities.order
        .get({ orderId: redemption.orderId })
        .go();
      if (order && !(await canRelease(order as OrderRecord))) continue;
    }
    const { canceled } = await coreTable.transaction
      .write((entities) =>
        expireOrderWrites(entities, {
          orderId: redemption.orderId,
          courseId,
          userId: redemption.userId,
          couponCode: code,
        }),
      )
      .go();
    if (!canceled) released++;
  }
  return released;
};
