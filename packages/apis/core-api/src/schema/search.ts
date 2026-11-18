/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Filters: values within one are OR, filters across fields are AND. Values
// are plain strings, not enums: an unknown value is valid and matches
// nothing, so a stale link shows an empty result rather than an error.
const filterValues = (max: number) => z.array(z.string().max(60)).max(max);

export const SEARCH_SORTS = ['relevance', 'rating', 'newest'] as const;

export const DURATION_BANDS = ['lt2', '2to10', '10to40', 'gt40'] as const;

export const SearchCoursesInputSchema = z.object({
  // Absent means browse: every published course, newest first.
  q: z.string().min(1).max(200).optional(),
  categoryId: z.string().max(100).optional(),
  tags: filterValues(8).optional(),
  levels: filterValues(10).optional(),
  languages: filterValues(20).optional(),
  durationBands: filterValues(10).optional(),
  // Relevance is the text query's score times the course's rating boost; with
  // no text it is the same as newest.
  sort: z.enum(SEARCH_SORTS).optional().default('relevance'),
  // Keeps courses whose average is at least this; an unrated course never
  // matches.
  minRating: z
    .union([z.literal(4.5), z.literal(4), z.literal(3.5), z.literal(3)])
    .optional(),
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
  imageKey: z.string().optional(),
  category: z
    .object({ id: z.string(), name: z.string(), slug: z.string() })
    .optional(),
  tags: z.array(z.string()),
  level: z.string().optional(),
  language: z.string().optional(),
  durationHours: z.number().optional(),
  ratingAverage: z.number().optional(),
  ratingCount: z.number(),
});

export type ISearchCourseHit = z.output<typeof SearchCourseHitSchema>;

const ValueCountSchema = z.object({ value: z.string(), count: z.number() });

export const SearchFacetsSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      count: z.number(),
    }),
  ),
  tags: z.array(ValueCountSchema),
  levels: z.array(ValueCountSchema),
  languages: z.array(ValueCountSchema),
  durationBands: z.array(ValueCountSchema),
});

export type ISearchFacets = z.output<typeof SearchFacetsSchema>;

export const SearchCoursesOutputSchema = z.object({
  items: z.array(SearchCourseHitSchema),
  cursor: z.number().nullable(),
  facets: SearchFacetsSchema,
});

export type ISearchCoursesOutput = z.output<typeof SearchCoursesOutputSchema>;
