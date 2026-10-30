/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { backfill } from '../src/index-sync/backfill.js';

// Run with: tsx scripts/backfill.ts (LOCAL_DEV=true locally, or with
// RUNTIME_CONFIG_APP_ID/AWS credentials for a deployed stage). Kept out of
// src/index-sync/backfill.ts itself: a top-level await there would break
// bundling for anything that imports this package's barrel (e.g. the search
// indexing Lambda), since CommonJS doesn't support it.
const { courses, lessons } = await backfill();
console.log(`Indexed ${courses} course(s) and ${lessons} lesson(s)`);
