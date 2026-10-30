/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import { createIndex } from '../indices.js';

// The course document in the search index: what a student-facing course search
// shows and filters on. The document is built from the core table's course
// record by the indexing pipeline (packages/events), so it stays in step with
// the table via its stream. The id is the course's key, so a write is
// idempotent and a replay or retry rewrites the same doc.
export const CourseDocument = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // The course's status in the core table. A search shows published courses
  // only (see searchProcedure's filter), but the field is indexed so other
  // callers can filter by it.
  status: z.enum(['draft', 'published', 'archived']),
  // The last time the course was published, if it has been; set on first
  // publish and never cleared. A course with one is safe to show.
  publishedAt: z.string().optional(),
  // Title and description, folded into one field the multi-match query runs
  // against, so a search matches either without an OR in the query.
  searchText: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CourseDocument = z.infer<typeof CourseDocument>;

// The mapping for what Zod can't express: title and description are analyzed
// (full-text), each with a keyword sub-field for exact-match filters and
// sorting, and searchText is analyzed for the cross-field match.
const mappings: Record<string, unknown> = {
  properties: {
    id: { type: 'keyword' },
    title: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    description: { type: 'text' },
    searchText: { type: 'text' },
    status: { type: 'keyword' },
    publishedAt: { type: 'date' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};

const settings: Record<string, unknown> = {
  index: {
    // One shard is plenty for a course index; keep the mapping cheap.
    number_of_shards: 1,
    number_of_replicas: 1,
  },
};

// The courses index: the definition is the default export (what
// generate-indices-manifest.ts reads); getCoursesIndex binds it for consumers.
const coursesIndex = createIndex({
  name: 'courses',
  schema: CourseDocument,
  settings,
  mappings,
});
export default coursesIndex;

// For consumer code (the search procedure, the indexing pipeline).
export const getCoursesIndex = async () =>
  coursesIndex.bind({
    client: await getOpenSearchClient(),
    index: resolveIndexName('courses'),
  });
