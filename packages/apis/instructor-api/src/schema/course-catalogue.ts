/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LANGUAGES, LEVELS } from '@discava/core-table';
import { z } from 'zod';
import { CourseSchema } from './course.js';

// Replace semantics: a field left out is cleared. Tags and the duration are
// normalised and range-checked by core-table's courseCatalogueWrites, which
// every writer shares; the shape is checked here.
export const UpdateCourseCatalogueInputSchema = z.object({
  courseId: z.string(),
  categoryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  level: z.enum(LEVELS).optional(),
  language: z.enum(LANGUAGES).optional(),
  durationHours: z.number().optional(),
});

export type IUpdateCourseCatalogueInput = z.output<
  typeof UpdateCourseCatalogueInputSchema
>;

export const UpdateCourseCatalogueOutputSchema = CourseSchema;

export const ListActiveCategoriesOutputSchema = z.array(
  z.object({ id: z.string(), name: z.string() }),
);
