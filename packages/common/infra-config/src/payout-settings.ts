/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PayoutSettings } from './stages.types.js';

const isNonNegativeInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Throws when a stage's payout settings could produce wrong money: a fee
 * outside 0 to 10000 basis points, or a hold or minimum that is negative or
 * not a whole number. Run whenever a stage is resolved, so a bad value fails
 * the build instead of a payout.
 */
export function validatePayoutSettings(
  stageName: string,
  payouts: PayoutSettings,
): void {
  const { platformFeeBasisPoints, holdDays, minimumPayoutMinor } = payouts;
  if (
    !isNonNegativeInteger(platformFeeBasisPoints) ||
    platformFeeBasisPoints > 10000
  ) {
    throw new Error(
      `Stage ${stageName}: payouts.platformFeeBasisPoints must be an integer from 0 to 10000, got ${String(platformFeeBasisPoints)}`,
    );
  }
  if (!isNonNegativeInteger(holdDays)) {
    throw new Error(
      `Stage ${stageName}: payouts.holdDays must be a non-negative integer, got ${String(holdDays)}`,
    );
  }
  if (!isNonNegativeInteger(minimumPayoutMinor)) {
    throw new Error(
      `Stage ${stageName}: payouts.minimumPayoutMinor must be a non-negative integer, got ${String(minimumPayoutMinor)}`,
    );
  }
}
