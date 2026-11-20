/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Payout account onboarding (specs/20261116-013137-instructor-payouts/
// contracts/instructor-api-payout.md). No input names an instructor.

export const PayoutAccountOutputSchema = z.object({
  status: z.enum([
    'unavailable',
    'not_started',
    'in_progress',
    'active',
    'restricted',
  ]),
  /** The stored status, because Stripe could not be reached. */
  stale: z.boolean().optional(),
});
export type IPayoutAccountOutput = z.infer<typeof PayoutAccountOutputSchema>;

export const StartOnboardingInputSchema = z.object({
  /** A path on the instructor portal the instructor comes back to. */
  returnPath: z.string().max(500),
});

export const PayoutLinkOutputSchema = z.object({ url: z.string() });

// Balances and payouts (contracts/instructor-api-payout.md, `payout.overview`).
export const PayoutOverviewOutputSchema = z.object({
  currencies: z.array(
    z.object({
      currency: z.string(),
      /** Open earnings still inside the hold period. */
      onHoldMinor: z.number().int(),
      /** Released earnings that wait for an active payout account. */
      waitingMinor: z.number().int(),
      /** Released earnings the next payout run sends. */
      readyMinor: z.number().int(),
      /** Open earnings of a payment account the platform no longer uses. */
      heldMinor: z.number().int(),
      /** When the earliest earnings still on hold are released. */
      nextReleaseAt: z.string().optional(),
    }),
  ),
  payouts: z.array(
    z.object({
      payoutId: z.string(),
      currency: z.string(),
      amountMinor: z.number().int(),
      status: z.enum(['pending', 'sent', 'failed']),
      failureReason: z.string().optional(),
      createdAt: z.string(),
      settledAt: z.string().optional(),
    }),
  ),
});
export type IPayoutOverviewOutput = z.infer<typeof PayoutOverviewOutputSchema>;
