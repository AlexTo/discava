/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const CheckoutInputSchema = z.object({
  courseId: z.string(),
});

export type ICheckoutInput = z.output<typeof CheckoutInputSchema>;

// Only the hosted page's address: never the order, the session or any other
// Stripe field.
export const CheckoutOutputSchema = z.object({
  checkoutUrl: z.string(),
});

export type ICheckoutOutput = z.output<typeof CheckoutOutputSchema>;

export const PaymentAvailableOutputSchema = z.object({
  available: z.boolean(),
});

export type IPaymentAvailableOutput = z.output<
  typeof PaymentAvailableOutputSchema
>;
