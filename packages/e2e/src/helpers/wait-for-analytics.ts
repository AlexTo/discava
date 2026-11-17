/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  checkAnalyticsMatchesRecords,
  createCoreTableService,
  type InvariantViolation,
  loadTableSnapshot,
  waitForAnalytics as waitForAnalyticsMatch,
} from '@discava/core-table';

// The local table, as `pnpm dev`'s APIs see it.
process.env.LOCAL_DEV = 'true';

/**
 * Waits up to 30 seconds for the instructor dashboard's aggregates to match
 * their records, re-reading the table and re-running only
 * `analytics-matches-records` (the aggregates trail the records by the
 * router's batching, the queue hop and the handler, see plan R2), and returns
 * the violations left. Every other check stays immediate.
 */
export const waitForAnalytics = (): Promise<InvariantViolation[]> =>
  waitForAnalyticsMatch({
    read: async () =>
      checkAnalyticsMatchesRecords(
        await loadTableSnapshot(await createCoreTableService()),
      ),
  });
