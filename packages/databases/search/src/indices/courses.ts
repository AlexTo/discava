/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { createIndex } from './create-index.js';

// Only a published course's doc is ever written -- see
// packages/events/src/search/search-indexing.ts -- so `status` here is always
// 'published'. It's still indexed (rather than assumed) so the search
// procedure can filter on it defensively, the same way publicListCourses
// re-checks status even though byStatus already scoped the query.
export const CourseDocumentSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // Key of its display image in the public media bucket (#76), carried so
  // search results can show it without a second lookup.
  imageKey: z.string().optional(),
  status: z.literal('published'),
  publishedAt: z.string(),
  updatedAt: z.string(),
  // The catalogue fields (see the course entity), all optional: a course
  // without them is in text results and under no facet value. The category's
  // name and slug are not stored; they are resolved from the category records
  // when a response is built, so a rename touches no document.
  categoryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  level: z.string().optional(),
  language: z.string().optional(),
  durationHours: z.number().int().optional(),
  // The course's ratings (see helpers/review-rating.ts in core-table), all
  // absent for an unrated course except `ratingBoost`, which is then 1.
  ratingCount: z.number().int().optional(),
  ratingAverage: z.number().optional(),
  ratingScore: z.number().optional(),
  ratingBoost: z.number().optional(),
  // What the course costs (see the course entity): minor units and the ISO
  // currency. Optional only because a document indexed before the price
  // existed has neither until the course is re-indexed.
  priceAmount: z.number().int().optional(),
  priceCurrency: z.string().optional(),
});

export type ICourseDocument = z.output<typeof CourseDocumentSchema>;

export default createIndex({
  name: 'courses',
  schema: CourseDocumentSchema,
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
  },
  mappings: {
    properties: {
      courseId: { type: 'keyword' },
      // `english` stems and drops stop words, so a search for "design" finds
      // "designing" and "table" finds "tables". The query side analyses its
      // terms with the same analyzer.
      title: { type: 'text', analyzer: 'english' },
      description: { type: 'text', analyzer: 'english' },
      imageKey: { type: 'keyword', index: false },
      status: { type: 'keyword' },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },
      // Added after the first version, all as new properties so putMapping
      // applies them to an existing index in place. A change to an existing
      // property's type or analyzer is breaking and needs #270's versioned
      // index. A keyword field takes an array, so `tags` needs no special type.
      categoryId: { type: 'keyword' },
      tags: { type: 'keyword' },
      level: { type: 'keyword' },
      language: { type: 'keyword' },
      durationHours: { type: 'integer' },
      // Ratings, also new properties; numeric fields need no analyzer.
      ratingCount: { type: 'integer' },
      ratingAverage: { type: 'float' },
      ratingScore: { type: 'float' },
      ratingBoost: { type: 'float' },
      // The price, also new properties.
      priceAmount: { type: 'integer' },
      priceCurrency: { type: 'keyword' },
    },
  },
});
