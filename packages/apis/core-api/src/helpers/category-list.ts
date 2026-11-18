/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '@discava/core-table';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

/**
 * Every category, archived included, from one query on the taxonomy's single
 * partition (a few hundred small records at most). Responses map a document's
 * categoryId to a name and slug through this.
 */
export const readCategories = async (coreTable: CoreTable) => {
  const { data } = await coreTable.entities.category.query
    .primary({})
    .go({ pages: 'all' });
  return data;
};
