/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createCoreTableService,
  rebuildCourseAnalytics,
} from '@discava/core-table';
import { parseCourseIds } from './args.js';

// Rebuilds the analytics aggregates of courses from their records: for
// repairing drift the `analytics-matches-records` invariant found, or
// backfilling a course. Usage:
//   pnpm nx run @discava/common-scripts:rebuild-analytics -- <courseId> ...
// Runs against local dev's table, or against the table RUNTIME_CONFIG_APP_ID's
// runtime configuration names when that is set (with AWS credentials in the
// environment).
if (!process.env.RUNTIME_CONFIG_APP_ID) {
  process.env.LOCAL_DEV = 'true';
}

let courseIds: string[];
try {
  courseIds = parseCourseIds(process.argv.slice(2));
} catch (error) {
  console.error(`[rebuild-analytics] ${(error as Error).message}`);
  process.exit(1);
}

const coreTable = await createCoreTableService();
for (const courseId of courseIds) {
  await rebuildCourseAnalytics(coreTable, courseId);
  console.log(`[rebuild-analytics] Rebuilt ${courseId}`);
}
