/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { createIndex } from './create-index.js';

// Only an effectively visible lesson's doc is written (visible, not
// archived, under a published course and a visible, non-archived module --
// see index-content.ts), so a search hit here never leaks a hidden or
// archived lesson. The search procedure still scopes the query to the
// caller's enrolled courses, since being indexed says nothing about who may
// see it.
export const LessonDocumentSchema = z.object({
  lessonId: z.string(),
  moduleId: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  updatedAt: z.string(),
});

export type ILessonDocument = z.output<typeof LessonDocumentSchema>;

export default createIndex({
  name: 'lessons',
  schema: LessonDocumentSchema,
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
  },
  mappings: {
    properties: {
      lessonId: { type: 'keyword' },
      moduleId: { type: 'keyword' },
      courseId: { type: 'keyword' },
      title: { type: 'text' },
      description: { type: 'text' },
      updatedAt: { type: 'date' },
    },
  },
});
