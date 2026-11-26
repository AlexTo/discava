/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const CheckoutInputSchema = z.object({
  courseId: z.string(),
  // A discount code as typed; the server validates it and prices the order.
  couponCode: z.string().max(100).optional(),
});

export type ICheckoutInput = z.output<typeof CheckoutInputSchema>;

// Only the hosted page's address: never the order, the session or any other
// Stripe field.
// Stripe's page to pay on, or, for a code that makes the course free, the
// enrolment itself: nothing to pay.
export const CheckoutOutputSchema = z.union([
  z.object({ checkoutUrl: z.string() }),
  z.object({ enrolled: z.literal(true) }),
]);

export type ICheckoutOutput = z.output<typeof CheckoutOutputSchema>;

export const PaymentAvailableOutputSchema = z.object({
  available: z.boolean(),
});

export type IPaymentAvailableOutput = z.output<
  typeof PaymentAvailableOutputSchema
>;

export const RequestRefundInputSchema = z.object({
  courseId: z.string(),
});

export type IRequestRefundInput = z.output<typeof RequestRefundInputSchema>;

// Never the order ID, the payment intent or any other Stripe field.
export const RequestRefundOutputSchema = z.object({
  refundRequestedAt: z.string(),
});

export type IRequestRefundOutput = z.output<typeof RequestRefundOutputSchema>;

export const MyOrderInputSchema = z.object({
  courseId: z.string(),
});

export type IMyOrderInput = z.output<typeof MyOrderInputSchema>;

// The one output that exposes order fields, and only to the order's own
// student: no order ID, account or payment intent.
export const MyOrderOutputSchema = z
  .object({
    status: z.enum(['paid', 'refunded']),
    amount: z.number(),
    currency: z.string(),
    paidAt: z.string(),
    refundWindowDays: z.number(),
    refundableUntil: z.string(),
    canRequestRefund: z.boolean(),
    refundBlockedBy: z
      .enum([
        'window-ended',
        'completed',
        'progress-limit',
        'refunded-before',
        'other-account',
      ])
      .optional(),
    refundProgressLimitPercent: z.number(),
    refundRequestedAt: z.string().optional(),
    refundFailedAt: z.string().optional(),
    refundedAt: z.string().optional(),
  })
  .nullable();

export type IMyOrderOutput = z.output<typeof MyOrderOutputSchema>;
