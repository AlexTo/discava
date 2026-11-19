/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// One line of the audit trail: who changed the connection, when, and how it
// went. Never a key: at most its last four characters.
export const PaymentChangeSchema = z.object({
  kind: z.enum(['connected', 'replaced', 'switched', 'disconnected', 'failed']),
  byName: z.string(),
  at: z.string(),
  mode: z.enum(['test', 'live']).optional(),
  keyLast4: z.string().optional(),
  // For a failed save, the step that failed.
  step: z
    .enum([
      'key',
      'account',
      'registration',
      'storage',
      'busy',
      'open-checkout',
    ])
    .optional(),
});

export const PaymentStatusOutputSchema = z.object({
  state: z.enum(['not-connected', 'active', 'changing', 'disconnected']),
  mode: z.enum(['test', 'live']).optional(),
  accountName: z.string().optional(),
  keyLast4: z.string().optional(),
  changedByName: z.string().optional(),
  changedAt: z.string().optional(),
  // Set while a checkout may still be open, until when.
  openCheckoutsUntil: z.string().optional(),
  // The confirmation address registered with Stripe is no longer the current
  // one: save the key again to register the new address.
  addressChanged: z.boolean().optional(),
  changes: z.array(PaymentChangeSchema),
});

export type IPaymentStatus = z.output<typeof PaymentStatusOutputSchema>;

export const ConnectPaymentInputSchema = z.object({
  // The Stripe secret key, shown only once and never echoed back. Its shape is
  // checked by the procedure so a bad one gets a fixed message that doesn't
  // repeat it.
  secretKey: z.string().max(512),
});

export const ConnectPaymentOutputSchema = PaymentStatusOutputSchema.extend({
  // A switch whose old registration could not be removed.
  warning: z.string().optional(),
});

export const DisconnectPaymentOutputSchema = ConnectPaymentOutputSchema;
