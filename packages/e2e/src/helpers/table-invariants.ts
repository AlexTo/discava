/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  checkTableInvariants,
  createCoreTableService,
  type InvariantViolation,
  loadTableSnapshot,
  violationId,
} from '@discava/core-table';
import { test as base, expect } from '@playwright/test';

// The local table, as `pnpm dev`'s APIs see it.
process.env.LOCAL_DEV = 'true';

const findViolations = async () =>
  checkTableInvariants(await loadTableSnapshot(await createCoreTableService()));

const describe = ({ invariant, message, record }: InvariantViolation) =>
  `${invariant}: ${message} ${JSON.stringify(record)}`;

// Scenarios take `test` from here rather than @playwright/test: after each one,
// the core table must still keep its invariants (#57). Only what the scenario
// broke counts, so older local data can't fail a run. The progress
// recalculation runs from the table's stream a few seconds after a change, so
// the check waits for it to catch up.
export const test = base.extend<{ tableInvariants: void }>({
  tableInvariants: [
    async ({}, use, testInfo) => {
      const before = new Set((await findViolations()).map(violationId));
      await use();
      // A failed scenario has already said what went wrong.
      if (testInfo.status !== testInfo.expectedStatus) {
        return;
      }
      await expect
        .poll(
          async () =>
            (await findViolations())
              .filter((violation) => !before.has(violationId(violation)))
              .map(describe),
          {
            message: 'The scenario left the core table breaking invariants',
            timeout: 30_000,
          },
        )
        .toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
