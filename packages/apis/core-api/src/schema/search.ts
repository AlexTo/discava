/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const SearchCoursesInputSchema = z.object({
  q: z.string().min(1).max(200),
  // An offset into the result set (OpenSearch's `from`), not an opaque
  // cursor token: unlike core-table's DynamoDB-backed lists, a search result
  // set isn't a stable ordered scan, so there's nothing to encode beyond a
  // position.
  cursor: z.number().int().min(0).optional(),
  limit: z.number().max(50).optional().default(10),
});

export type ISearchCoursesInput = z.output<typeof SearchCoursesInputSchema>;

export const SearchCourseHitSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

export type ISearchCourseHit = z.output<typeof SearchCourseHitSchema>;

export const SearchCoursesOutputSchema = z.object({
  items: z.array(SearchCourseHitSchema),
  cursor: z.number().nullable(),
});

export type ISearchCoursesOutput = z.output<typeof SearchCoursesOutputSchema>;
