/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { InvariantViolation } from './invariants.js';

export interface WaitForAnalyticsOptions {
  /** Reads the table and returns the `analytics-matches-records` violations. */
  read: () => Promise<InvariantViolation[]>;
  /** How long to keep trying. @default 30 seconds */
  timeoutMs?: number;
  /** How long to wait between reads. @default 1 second */
  intervalMs?: number;
}

/**
 * Reads again until the analytics match their records, or the time is up, and
 * returns the violations of the last read (none when they matched). The
 * aggregates trail the records: the stream router batches for a few seconds,
 * then the queue hop and the handler follow, so a check made right after a
 * change would report a difference that closes by itself. For the e2e suite's
 * post-test check of that one invariant (plan R2).
 */
export const waitForAnalytics = async ({
  read,
  timeoutMs = 30_000,
  intervalMs = 1_000,
}: WaitForAnalyticsOptions): Promise<InvariantViolation[]> => {
  const deadline = Date.now() + timeoutMs;
  let violations = await read();
  while (violations.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    violations = await read();
  }
  return violations;
};
