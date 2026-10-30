/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import { createIndex } from '../indices.js';

// The lesson document in the search index. A lesson is searchable only when
// it and its module are effectively visible and the course is published, so
// the document carries the module's and course's own visibility flags (not
// just the lesson's): the search filters on them (see searchAcross), and the
// indexing pipeline writes them from the course's curriculum, which it loads
// when it reindexes a lesson or its module.
export const LessonDocument = z.object({
  id: z.string(),
  courseId: z.string(),
  moduleId: z.string(),
  // The module's title, so a result names where the lesson sits without a
  // second read. Written by the indexing pipeline from the module record.
  moduleTitle: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // Title and description, folded into one field the multi-match query runs
  // against.
  searchText: z.string(),
  // The lesson's own visibility/archived state.
  visibility: z.enum(['hidden', 'visible']),
  archivedAt: z.string().optional(),
  // The module's visibility/archived state, for the effectively-visible check.
  moduleVisibility: z.enum(['hidden', 'visible']),
  moduleArchivedAt: z.string().optional(),
  // The course's status; a lesson is shown only under a published course.
  courseStatus: z.enum(['draft', 'published', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LessonDocument = z.infer<typeof LessonDocument>;

// The mapping for what Zod can't express: title is analyzed with a keyword
// sub-field for exact-match filters and sorting; the visibility flags and
// courseStatus are keyword filters.
const mappings: Record<string, unknown> = {
  properties: {
    id: { type: 'keyword' },
    courseId: { type: 'keyword' },
    moduleId: { type: 'keyword' },
    moduleTitle: { type: 'keyword' },
    title: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    description: { type: 'text' },
    searchText: { type: 'text' },
    visibility: { type: 'keyword' },
    archivedAt: { type: 'date' },
    moduleVisibility: { type: 'keyword' },
    moduleArchivedAt: { type: 'date' },
    courseStatus: { type: 'keyword' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};

const settings: Record<string, unknown> = {
  index: {
    number_of_shards: 1,
    number_of_replicas: 1,
  },
};

// The lessons index: the definition is the default export (what
// generate-indices-manifest.ts reads); getLessonsIndex binds it for consumers.
const lessonsIndex = createIndex({
  name: 'lessons',
  schema: LessonDocument,
  settings,
  mappings,
});
export default lessonsIndex;

// For consumer code (the search procedure, the indexing pipeline).
export const getLessonsIndex = async () =>
  lessonsIndex.bind({
    client: await getOpenSearchClient(),
    index: resolveIndexName('lessons'),
  });
