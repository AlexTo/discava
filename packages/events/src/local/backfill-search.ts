/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createCoreTableService } from '@discava/core-table';
import { backfillSearchIndexes } from '../search/backfill.js';

if (process.env.LOCAL_DEV !== 'true') {
  throw new Error(
    'The search backfill is for local dev only (LOCAL_DEV=true); against a ' +
      'deployed environment, run the deployed backfill instead',
  );
}

const coreTable = await createCoreTableService();
const { courses, users } = await backfillSearchIndexes({ coreTable });
console.log(
  `[backfill-search] reindexed ${courses} course(s) and ${users} user(s)`,
);
