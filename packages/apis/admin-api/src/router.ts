/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from './init.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
} from './procedures/category.js';

export const router = t.router;

export const appRouter = router({
  category: router({
    list: listCategories,
    create: createCategory,
    rename: renameCategory,
    archive: archiveCategory,
  }),
});

export type AppRouter = typeof appRouter;
