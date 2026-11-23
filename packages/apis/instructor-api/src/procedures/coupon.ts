/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  couponStatus,
  couponValueProblem,
  generateCouponCode,
  isConditionalCheckFailed,
  normaliseCouponCode,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { getCourseOrThrow } from '../helpers/course-access.js';
import { courseInstructorProcedure } from '../init.js';
import {
  CreateCouponInputSchema,
  CreateCouponOutputSchema,
  DeleteCouponInputSchema,
  DeleteCouponOutputSchema,
  ListCouponsInputSchema,
  ListCouponsOutputSchema,
  UpdateCouponInputSchema,
  UpdateCouponOutputSchema,
} from '../schema/index.js';

const MAX_GENERATED_CODE_TRIES = 5;

const badRequest = (message: string) =>
  new TRPCError({ code: 'BAD_REQUEST', message });

const codeTaken = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: 'This code already exists for the course',
  });

type StoredCoupon = {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  currency?: string | undefined;
  expiresAt?: string | undefined;
  maxRedemptions?: number | undefined;
  redeemedCount: number;
  enabled: boolean;
};

const toCoupon = (coupon: StoredCoupon, now: string) => ({
  code: coupon.code,
  type: coupon.type,
  value: coupon.value,
  ...(coupon.currency !== undefined && { currency: coupon.currency }),
  ...(coupon.expiresAt !== undefined && { expiresAt: coupon.expiresAt }),
  ...(coupon.maxRedemptions !== undefined && {
    maxRedemptions: coupon.maxRedemptions,
  }),
  redeemedCount: coupon.redeemedCount,
  enabled: coupon.enabled,
  status: couponStatus(coupon, now),
});

// Makes a discount code for a paid course. Allowed at any course status, and
// never writes the course record. The create is conditional on the code not
// existing, so two instructors typing the same code cannot both succeed.
export const createCoupon = courseInstructorProcedure(CreateCouponInputSchema)
  .output(CreateCouponOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, type, value, expiresOn, maxRedemptions } = input;
    const now = new Date();

    let typedCode: string | undefined;
    if (input.code !== undefined) {
      typedCode = normaliseCouponCode(input.code);
      if (typedCode === undefined) {
        throw badRequest(
          'code must be 4 to 24 characters of letters, digits and -',
        );
      }
    }
    if (expiresOn !== undefined && expiresOn < now.toISOString().slice(0, 10)) {
      throw badRequest('expiresOn must be today or later');
    }

    const course = await getCourseOrThrow(coreTable, courseId);
    if (course.priceAmount <= 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Coupons need a paid course',
      });
    }
    const currency = type === 'fixed' ? course.priceCurrency : undefined;
    const valueProblem = couponValueProblem({
      type,
      value,
      currency,
      listAmount: course.priceAmount,
    });
    if (valueProblem) {
      throw badRequest(valueProblem);
    }

    for (let attempt = 0; attempt < MAX_GENERATED_CODE_TRIES; attempt++) {
      const code = typedCode ?? generateCouponCode();
      try {
        const { data } = await coreTable.entities.coupon
          .create({
            courseId,
            code,
            type,
            value,
            ...(currency !== undefined && { currency }),
            ...(expiresOn !== undefined && {
              expiresAt: `${expiresOn}T23:59:59.999Z`,
            }),
            ...(maxRedemptions !== undefined && { maxRedemptions }),
            createdBy: ctx.user.sub,
          })
          .go();
        return toCoupon(data, now.toISOString());
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          throw error;
        }
        // A typed code that is taken is the instructor's to change; a
        // generated one is simply drawn again.
        if (typedCode !== undefined) {
          throw codeTaken();
        }
      }
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not generate an unused code; try again',
    });
  });

// A course's coupons, newest first, with the status derived now.
export const listCoupons = courseInstructorProcedure(ListCouponsInputSchema)
  .output(ListCouponsOutputSchema)
  .query(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const { data } = await ctx.coreTable.entities.coupon.query
      .primary({ courseId: input.courseId })
      .go({ pages: 'all' });
    const newestFirst = [...data].sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.code.localeCompare(b.code),
    );
    return { items: newestFirst.map((coupon) => toCoupon(coupon, now)) };
  });

const couponNotFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Coupon not found' });

// Changes a code's switch, expiry or limit. A lowered limit is a condition on
// the write (redeemedCount <= the new limit), not a prior read, so a claim
// racing the update cannot slip the count above it. The write also requires
// the code to exist, so a missing one is never created by a patch.
export const updateCoupon = courseInstructorProcedure(UpdateCouponInputSchema)
  .output(UpdateCouponOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, enabled, expiresOn, maxRedemptions } = input;
    const now = new Date();

    const code = normaliseCouponCode(input.code);
    if (code === undefined) {
      throw couponNotFound();
    }
    if (
      enabled === undefined &&
      expiresOn === undefined &&
      maxRedemptions === undefined
    ) {
      throw badRequest('nothing to update');
    }
    if (
      typeof expiresOn === 'string' &&
      expiresOn < now.toISOString().slice(0, 10)
    ) {
      throw badRequest('expiresOn must be today or later');
    }

    const patch = coreTable.entities.coupon.patch({ courseId, code }).set({
      ...(enabled !== undefined && { enabled }),
      ...(typeof expiresOn === 'string' && {
        expiresAt: `${expiresOn}T23:59:59.999Z`,
      }),
      ...(typeof maxRedemptions === 'number' && { maxRedemptions }),
    });
    const cleared = [
      ...(expiresOn === null ? (['expiresAt'] as const) : []),
      ...(maxRedemptions === null ? (['maxRedemptions'] as const) : []),
    ];
    const write = cleared.length > 0 ? patch.remove([...cleared]) : patch;

    try {
      const { data } = await write
        .where((attr, op) =>
          typeof maxRedemptions === 'number'
            ? `${op.exists(attr.code)} AND ${op.lte(attr.redeemedCount, maxRedemptions)}`
            : op.exists(attr.code),
        )
        .go({ response: 'all_new' });
      return toCoupon(data as StoredCoupon, now.toISOString());
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }

    const { data: current } = await coreTable.entities.coupon
      .get({ courseId, code })
      .go();
    if (!current) {
      throw couponNotFound();
    }
    if (
      typeof maxRedemptions === 'number' &&
      current.redeemedCount > maxRedemptions
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `The limit cannot be below the ${current.redeemedCount} redemptions already held`,
      });
    }
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The code was changed by another request; please retry',
    });
  });

// Removes a code nobody has redeemed. The delete is conditional on a zero
// count, so a claim landing meanwhile keeps the code; a used code is disabled
// instead.
export const deleteCoupon = courseInstructorProcedure(DeleteCouponInputSchema)
  .output(DeleteCouponOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId } = input;

    const code = normaliseCouponCode(input.code);
    if (code === undefined) {
      throw couponNotFound();
    }

    try {
      await coreTable.entities.coupon
        .delete({ courseId, code })
        .where(
          (attr, op) =>
            `${op.exists(attr.code)} AND ${op.eq(attr.redeemedCount, 0)}`,
        )
        .go();
      return { success: true as const };
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }

    const { data: current } = await coreTable.entities.coupon
      .get({ courseId, code })
      .go();
    if (!current) {
      throw couponNotFound();
    }
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This code has redemptions; disable it instead',
    });
  });
