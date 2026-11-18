/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  courseCount: z.number(),
});

export type ICategory = z.output<typeof CategorySchema>;

export const ListCategoriesOutputSchema = z.array(CategorySchema);

export const CategoryBySlugInputSchema = z.object({
  slug: z.string().min(1).max(100),
});

export const CategoryBySlugOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'archived']),
});

export type ICategoryBySlug = z.output<typeof CategoryBySlugOutputSchema>;
