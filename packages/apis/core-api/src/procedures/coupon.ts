/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { checkCoupon } from '../helpers/coupon-check.js';
import { courseProcedure } from '../init.js';
import {
  CouponPreviewInputSchema,
  CouponPreviewOutputSchema,
} from '../schema/index.js';

// What the student would pay with a code. Reads only: it reserves nothing and
// writes nothing, so a preview never uses up a code. `payment.checkout`
// validates the code again, as this does, and prices the order itself.
export const couponPreview = courseProcedure
  .input(CouponPreviewInputSchema)
  .output(CouponPreviewOutputSchema)
  .query(async ({ ctx, input }) => {
    const { code, course, price } = await checkCoupon({
      coreTable: ctx.coreTable,
      courseId: input.courseId,
      userId: ctx.user.sub,
      input: input.code,
      now: new Date().toISOString(),
    });
    return {
      code,
      listAmount: price.listAmount,
      discountAmount: price.discountAmount,
      totalAmount: price.totalAmount,
      currency: course.priceCurrency,
      isFree: price.isFree,
    };
  });
