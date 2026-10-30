/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { createIndex } from './create-index.js';

// Only a published course's doc is ever written -- see
// packages/events/src/search/index-content.ts -- so `status` here is always
// 'published'. It's still indexed (rather than assumed) so the search
// procedure can filter on it defensively, the same way publicListCourses
// re-checks status even though byStatus already scoped the query.
export const CourseDocumentSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.literal('published'),
  publishedAt: z.string(),
  updatedAt: z.string(),
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
      title: { type: 'text' },
      description: { type: 'text' },
      status: { type: 'keyword' },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },
    },
  },
});
