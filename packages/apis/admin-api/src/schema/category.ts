/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// The name is trimmed, length-checked and made URL-safe by core-table's
// categoryWrites, which every writer shares (a bad name is BAD_REQUEST).
export const CategoryNameSchema = z.string();

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'archived']),
});

export const CategoryWithCountSchema = CategorySchema.extend({
  courseCount: z.number(),
});

export const ListCategoriesOutputSchema = z.array(CategoryWithCountSchema);

export const CreateCategoryInputSchema = z.object({
  name: CategoryNameSchema,
});

export const RenameCategoryInputSchema = z.object({
  id: z.string(),
  name: CategoryNameSchema,
});

export const ArchiveCategoryInputSchema = z.object({ id: z.string() });
