/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  belowMinimumCharge,
  COUPON_REFUSALS,
  type CouponPrice,
  couponStatus,
  type createCoreTableService,
  normaliseCouponCode,
  priceWithCoupon,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

const refuse = (message: string) =>
  new TRPCError({ code: 'PRECONDITION_FAILED', message });

type Loaded<E extends 'course' | 'coupon'> = NonNullable<
  Awaited<ReturnType<ReturnType<CoreTable['entities'][E]['get']>['go']>>['data']
>;

/** The course and coupon a code resolves to, and what the student would pay. */
export interface CouponCheck {
  code: string;
  course: Loaded<'course'>;
  coupon: Loaded<'coupon'>;
  price: CouponPrice;
}

/**
 * Everything `coupon.preview` and a checkout with a code refuse on, read only:
 * the course and the coupon (two keyed gets) and the student's enrolment and
 * redemption. The unknown code, another course's code, a fixed code in another
 * currency and any code on a free course are one refusal, so a student cannot
 * tell them apart. A reservation the student already holds for this code does
 * not count against them: the checkout that made it is replaced, or reused.
 */
export const checkCoupon = async ({
  coreTable,
  courseId,
  userId,
  input,
  now,
}: {
  coreTable: CoreTable;
  courseId: string;
  userId: string;
  input: string;
  now: string;
}): Promise<CouponCheck> => {
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  if (!course || course.status !== 'published') {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  const code = normaliseCouponCode(input);
  if (code === undefined || course.priceAmount === 0) {
    throw refuse(COUPON_REFUSALS.invalid);
  }
  const { data: coupon } = await coreTable.entities.coupon
    .get({ courseId, code })
    .go();
  if (
    !coupon ||
    (coupon.type === 'fixed' &&
      coupon.currency?.toLowerCase() !== course.priceCurrency.toLowerCase())
  ) {
    throw refuse(COUPON_REFUSALS.invalid);
  }

  const [{ data: enrolment }, { data: redemption }] = await Promise.all([
    coreTable.entities.enrolment.get({ courseId, userId }).go(),
    coreTable.entities.couponRedemption.get({ courseId, code, userId }).go(),
  ]);
  if (enrolment && enrolment.status !== 'dropped') {
    throw refuse(COUPON_REFUSALS.alreadyEnrolled);
  }
  if (redemption?.status === 'redeemed') {
    throw refuse(COUPON_REFUSALS.alreadyUsed);
  }

  // The student's own reservation is one of the count, so it is not "used up"
  // for them.
  const status = couponStatus(
    redemption
      ? { ...coupon, redeemedCount: Math.max(0, coupon.redeemedCount - 1) }
      : coupon,
    now,
  );
  if (status === 'disabled') throw refuse(COUPON_REFUSALS.disabled);
  if (status === 'expired') throw refuse(COUPON_REFUSALS.expired);
  if (status === 'used up') throw refuse(COUPON_REFUSALS.usedUp);

  const price = priceWithCoupon({ listAmount: course.priceAmount, coupon });
  if (belowMinimumCharge(price.totalAmount, course.priceCurrency)) {
    throw refuse(COUPON_REFUSALS.belowMinimum);
  }
  return { code, course, coupon, price };
};
