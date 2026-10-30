/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import { createIndex } from '../indices.js';

// The module document in the search index. A module is searchable only when
// it and its course are effectively visible/published, so the document
// carries the module's own visibility and the course's status: the search
// filters on them (see searchAcross), and the indexing pipeline writes them
// from the course's curriculum, which it loads when it reindexes a module.
export const ModuleDocument = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  // Title and description, folded into one field the multi-match query runs
  // against.
  searchText: z.string(),
  visibility: z.enum(['hidden', 'visible']),
  archivedAt: z.string().optional(),
  // The course's status; a module is shown only under a published course.
  courseStatus: z.enum(['draft', 'published', 'archived']),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ModuleDocument = z.infer<typeof ModuleDocument>;

// The mapping for what Zod can't express: title is analyzed with a keyword
// sub-field for exact-match filters and sorting; visibility and courseStatus
// are keyword filters.
const mappings: Record<string, unknown> = {
  properties: {
    id: { type: 'keyword' },
    courseId: { type: 'keyword' },
    title: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    description: { type: 'text' },
    searchText: { type: 'text' },
    visibility: { type: 'keyword' },
    archivedAt: { type: 'date' },
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

// The modules index: the definition is the default export (what
// generate-indices-manifest.ts reads); getModulesIndex binds it.
const modulesIndex = createIndex({
  name: 'modules',
  schema: ModuleDocument,
  settings,
  mappings,
});
export default modulesIndex;

// For consumer code (the search procedure, the indexing pipeline).
export const getModulesIndex = async () =>
  modulesIndex.bind({
    client: await getOpenSearchClient(),
    index: resolveIndexName('modules'),
  });
