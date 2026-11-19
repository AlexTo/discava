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
