/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const SearchQueryInputSchema = z.object({
  q: z.string().min(1).max(200),
  // An offset into the result set (OpenSearch's `from`), not an opaque
  // cursor token: unlike core-table's DynamoDB-backed lists, a search result
  // set isn't a stable ordered scan, so there's nothing to encode beyond a
  // position.
  cursor: z.number().int().min(0).optional(),
  limit: z.number().max(50).optional().default(10),
});

export type ISearchQueryInput = z.output<typeof SearchQueryInputSchema>;

export const SearchCourseHitSchema = z.object({
  type: z.literal('course'),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

export type ISearchCourseHit = z.output<typeof SearchCourseHitSchema>;

export const SearchLessonHitSchema = z.object({
  type: z.literal('lesson'),
  lessonId: z.string(),
  moduleId: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

export type ISearchLessonHit = z.output<typeof SearchLessonHitSchema>;

export const SearchHitSchema = z.discriminatedUnion('type', [
  SearchCourseHitSchema,
  SearchLessonHitSchema,
]);

export type ISearchHit = z.output<typeof SearchHitSchema>;

export const SearchQueryOutputSchema = z.object({
  items: z.array(SearchHitSchema),
  cursor: z.number().nullable(),
});

export type ISearchQueryOutput = z.output<typeof SearchQueryOutputSchema>;
