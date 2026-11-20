/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createCoreTableService } from '@discava/core-table';
import { seedCategories } from './seed-categories.js';

// Writes the starting categories (Science, Technology, Mathematics,
// Communication, Business), skipping any that exist. Usage:
//   pnpm nx run @discava/tooling-deploy:seed-categories
// Runs against local dev's table, or against the table RUNTIME_CONFIG_APP_ID's
// runtime configuration names when that is set (with the stage's AWS
// credentials in the environment).
if (!process.env.RUNTIME_CONFIG_APP_ID) {
  process.env.LOCAL_DEV = 'true';
}

const created = await seedCategories(await createCoreTableService());
console.log(
  created.length
    ? `[seed-categories] Created ${created.join(', ')}`
    : '[seed-categories] Nothing to create: every category exists',
);
