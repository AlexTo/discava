/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import { createIndex } from '../indices.js';

// The user document in the search index: what a user search (e.g. an
// instructor finding a student, or a "who" query) shows. A user's record is
// written by the core table's pre-token-generation trigger, which reaches the
// indexer through SEARCH_STREAM_FILTERS. Name and email are analyzed; the
// search matches either (see searchText).
export const UserDocument = z.object({
  id: z.string(),
  email: z.string().optional(),
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  // Given and family name joined, or the email when there's no name: what a
  // result shows and what the search matches on.
  displayName: z.string().optional(),
  // Name and email, folded into one field the multi-match query runs against.
  searchText: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserDocument = z.infer<typeof UserDocument>;

// The mapping for what Zod can't express: the name fields are analyzed with
// keyword sub-fields for exact-match filters and sorting; the email and the
// folded field are analyzed too.
const mappings: Record<string, unknown> = {
  properties: {
    id: { type: 'keyword' },
    email: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    givenName: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    familyName: {
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    },
    displayName: { type: 'text' },
    searchText: { type: 'text' },
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

// The users index: the definition is the default export (what
// generate-indices-manifest.ts reads); getUsersIndex binds it.
const usersIndex = createIndex({
  name: 'users',
  schema: UserDocument,
  settings,
  mappings,
});
export default usersIndex;

// For consumer code (the search procedure, the indexing pipeline).
export const getUsersIndex = async () =>
  usersIndex.bind({
    client: await getOpenSearchClient(),
    index: resolveIndexName('users'),
  });
