/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import { createIndex } from '../indices.js';

// The content item document in the search index. A content item is searchable
// only when it and every ancestor are effectively visible and the course is
// published, so the document carries its own, its lesson's and its course's
// visibility flags: the search filters on them (see searchAcross), and the
// indexing pipeline writes them from the course's curriculum, which it loads
// when it reindexes an item or its ancestor.
export const ContentItemDocument = z.object({
  id: z.string(),
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  // The lesson's title, so a result names where the item sits without a
  // second read.
  lessonTitle: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // What kind of item it is; a search can filter on it (e.g. only videos).
  type: z.enum(['video', 'text', 'quiz', 'file']),
  // Title and description, folded into one field the multi-match query runs
  // against.
  searchText: z.string(),
  // The item's own visibility/archived state.
  visibility: z.enum(['hidden', 'visible']),
  archivedAt: z.string().optional(),
  // The lesson's visibility/archived state, for the effectively-visible check.
  lessonVisibility: z.enum(['hidden', 'visible']),
  lessonArchivedAt: z.string().optional(),
  // The course's status; an item is shown only under a published course.
  courseStatus: z.enum(['draft', 'published', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContentItemDocument = z.infer<typeof ContentItemDocument>;

// The mapping for what Zod can't express: title is analyzed with a keyword
// sub-field for exact-match filters and sorting; the visibility flags, type
// and courseStatus are keyword filters.
const mappings: Record<string, unknown> = {
  properties: {
    id: { type: 'keyword' },
    courseId: { type: 'keyword' },
    moduleId: { type: 'keyword' },
    lessonId: { type: 'keyword' },
    lessonTitle: { type: 'keyword' },
    title: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    description: { type: 'text' },
    type: { type: 'keyword' },
    searchText: { type: 'text' },
    visibility: { type: 'keyword' },
    archivedAt: { type: 'date' },
    lessonVisibility: { type: 'keyword' },
    lessonArchivedAt: { type: 'date' },
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

// The content items index: the definition is the default export (what
// generate-indices-manifest.ts reads); getContentItemsIndex binds it.
const contentItemsIndex = createIndex({
  name: 'content-items',
  schema: ContentItemDocument,
  settings,
  mappings,
});
export default contentItemsIndex;

// For consumer code (the search procedure, the indexing pipeline).
export const getContentItemsIndex = async () =>
  contentItemsIndex.bind({
    client: await getOpenSearchClient(),
    index: resolveIndexName('content-items'),
  });
