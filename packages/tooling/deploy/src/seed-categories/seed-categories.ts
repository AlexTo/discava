/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  categoryWrites,
  type createCoreTableService,
  NameConflictError,
} from '@discava/core-table';
import { v7 as uuidv7 } from 'uuid';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

export const DEFAULT_CATEGORIES = [
  'Science',
  'Technology',
  'Mathematics',
  'Communication',
  'Business',
] as const;

/**
 * Writes the starting categories through categoryWrites. Idempotent by name:
 * a category whose name already exists (ignoring case and spacing) is left
 * as it is. Returns the names it created.
 */
export const seedCategories = async (
  coreTable: CoreTable,
  names: readonly string[] = DEFAULT_CATEGORIES,
) => {
  const created: string[] = [];
  for (const name of names) {
    try {
      await categoryWrites.create(coreTable, { categoryId: uuidv7(), name });
      created.push(name);
    } catch (error) {
      if (!(error instanceof NameConflictError)) {
        throw error;
      }
    }
  }
  return created;
};
