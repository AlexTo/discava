/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  couponStatus,
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
  ListCouponsInputSchema,
  ListCouponsOutputSchema,
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
    if (type === 'fixed' && value > course.priceAmount) {
      throw badRequest("value must not be above the course's price");
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
            ...(type === 'fixed' && { currency: course.priceCurrency }),
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
