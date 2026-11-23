/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Discount codes for a course (specs/20261116-013138-coupons-discount-codes/
// contracts/instructor-api-coupon.md). The code's own format and the fixed
// value's bound by the list price are checked in the procedure, which has the
// code helpers and the course, as is the value's range (couponValueProblem).

export const CouponSchema = z.object({
  code: z.string(),
  type: z.enum(['percent', 'fixed']),
  value: z.number(),
  currency: z.string().optional(),
  expiresAt: z.string().optional(),
  maxRedemptions: z.number().optional(),
  redeemedCount: z.number(),
  enabled: z.boolean(),
  status: z.enum(['disabled', 'expired', 'used up', 'active']),
});

export type ICoupon = z.output<typeof CouponSchema>;

// A calendar date, UTC.
const ExpiresOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expiresOn must be YYYY-MM-DD')
  .refine((date) => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
    );
  }, 'expiresOn must be a real date');

const MaxRedemptionsSchema = z
  .number()
  .int('maxRedemptions must be a whole number')
  .min(1, 'maxRedemptions must be at least 1');

export const CreateCouponInputSchema = z.object({
  courseId: z.string().min(1),
  code: z.string().optional(),
  type: z.enum(['percent', 'fixed']),
  value: z.number(),
  expiresOn: ExpiresOnSchema.optional(),
  maxRedemptions: MaxRedemptionsSchema.optional(),
});

export type ICreateCouponInput = z.output<typeof CreateCouponInputSchema>;

export const CreateCouponOutputSchema = CouponSchema;

export const ListCouponsInputSchema = z.object({
  courseId: z.string().min(1),
});

export type IListCouponsInput = z.output<typeof ListCouponsInputSchema>;

export const ListCouponsOutputSchema = z.object({
  items: z.array(CouponSchema),
});

export type IListCouponsOutput = z.output<typeof ListCouponsOutputSchema>;

// `null` clears the expiry or the limit. Strict, so a type or value (which a
// code never changes) is refused rather than silently ignored.
export const UpdateCouponInputSchema = z
  .object({
    courseId: z.string().min(1),
    code: z.string().min(1),
    enabled: z.boolean().optional(),
    expiresOn: ExpiresOnSchema.nullable().optional(),
    maxRedemptions: MaxRedemptionsSchema.nullable().optional(),
  })
  .strict();

export type IUpdateCouponInput = z.output<typeof UpdateCouponInputSchema>;

export const UpdateCouponOutputSchema = CouponSchema;

export const DeleteCouponInputSchema = z.object({
  courseId: z.string().min(1),
  code: z.string().min(1),
});

export type IDeleteCouponInput = z.output<typeof DeleteCouponInputSchema>;

export const DeleteCouponOutputSchema = z.object({ success: z.literal(true) });
