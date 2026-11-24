/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const CouponPreviewInputSchema = z.object({
  courseId: z.string(),
  // As the student typed it; the server normalises it.
  code: z.string().max(100),
});

export type ICouponPreviewInput = z.output<typeof CouponPreviewInputSchema>;

// What the student would pay, in the course's currency's minor units. Never
// the coupon record: its limit, its count and its other holders stay private.
export const CouponPreviewOutputSchema = z.object({
  code: z.string(),
  listAmount: z.number(),
  discountAmount: z.number(),
  totalAmount: z.number(),
  currency: z.string(),
  isFree: z.boolean(),
});

export type ICouponPreviewOutput = z.output<typeof CouponPreviewOutputSchema>;
