/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// The search query, in one place: which content types can be searched, and
// the query that runs against each. The API's search procedure calls
// searchAcross with the types to search; it does not build the OpenSearch
// query.
//
// A document is searchable only when a student may see it: it, every
// ancestor and (for content) the course are visible, not archived, and the
// course is published. That is the same rule as the core table's
// filterEffectivelyVisible, expressed as a per-index bool filter here, so the
// index's visibility fields (written by the indexing pipeline) are what keep
// hidden and archived content out of results.

import type { Client } from '@opensearch-project/opensearch';
import { getOpenSearchClient, resolveIndexName } from './client.js';

// A hit, as the client returns it (its `body` is untyped `any`, so the shape
// is named here). `_score` is present for every hit from a scored query.
interface Hit {
  _score: number;
  _source: Record<string, unknown>;
}

export const SEARCH_TYPES = [
  'course',
  'module',
  'lesson',
  'contentItem',
  'user',
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

// A content-type search: which index to run in, the fields the query matches,
// and the filter that keeps only what the caller may see.
interface TypeSearch {
  indexName: string;
  matchFields: string[];
  filter: Record<string, unknown>;
}

// The caller's scope: which courses' content they may see. A student is scoped
// to the courses they're enrolled in; an instructor or admin has no scope, so
// every published course's content is in range. A student with no enrolments
// is scoped to no courses and sees no content, only published courses.
export interface SearchScope {
  courseIds?: readonly string[];
}

// The enrolment gate, applied to content (module, lesson, content item) but
// not to courses themselves: a student may search for any published course
// and enrol from the result, but may only see a course's content when
// enrolled in it. `terms` over an empty list matches nothing, so an
// unenrolled student gets no content hits.
const courseScopeFilter = (scope?: SearchScope): Record<string, unknown>[] =>
  scope?.courseIds !== undefined
    ? [{ terms: { courseId: [...scope.courseIds] } }]
    : [];

// The filters, one per index. `visible` and the archived check are the
// document's own state; the extra clauses are the ancestor and course checks
// (the course-status check is the document's copy of its course's status;
// courses filter on their own status instead) and the enrolment scope.
const visibleFilter = (
  extra: Record<string, unknown>[] = [],
): Record<string, unknown> => ({
  bool: {
    filter: [
      { term: { visibility: 'visible' } },
      { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
      ...extra,
    ],
  },
});

const courseSearch = (): TypeSearch => ({
  indexName: resolveIndexName('courses'),
  matchFields: ['searchText', 'title'],
  filter: { term: { status: 'published' } },
});

const moduleSearch = (scope?: SearchScope): TypeSearch => ({
  indexName: resolveIndexName('modules'),
  matchFields: ['searchText', 'title'],
  filter: visibleFilter([
    { term: { courseStatus: 'published' } },
    ...courseScopeFilter(scope),
  ]),
});

const lessonSearch = (scope?: SearchScope): TypeSearch => ({
  indexName: resolveIndexName('lessons'),
  matchFields: ['searchText', 'title'],
  filter: visibleFilter([
    { term: { moduleVisibility: 'visible' } },
    { bool: { must_not: [{ exists: { field: 'moduleArchivedAt' } }] } },
    { term: { courseStatus: 'published' } },
    ...courseScopeFilter(scope),
  ]),
});

const contentItemSearch = (scope?: SearchScope): TypeSearch => ({
  indexName: resolveIndexName('content-items'),
  matchFields: ['searchText', 'title'],
  filter: visibleFilter([
    { term: { lessonVisibility: 'visible' } },
    { bool: { must_not: [{ exists: { field: 'lessonArchivedAt' } }] } },
    { term: { courseStatus: 'published' } },
    ...courseScopeFilter(scope),
  ]),
});

// Users carry no visibility flags: the API decides who may search them (an
// instructor or admin), not the index.
const userSearch = (): TypeSearch => ({
  indexName: resolveIndexName('users'),
  matchFields: ['searchText', 'displayName'],
  filter: {},
});

const TYPE_SEARCHES: Record<SearchType, (scope?: SearchScope) => TypeSearch> = {
  course: () => courseSearch(),
  module: (scope) => moduleSearch(scope),
  lesson: (scope) => lessonSearch(scope),
  contentItem: (scope) => contentItemSearch(scope),
  user: () => userSearch(),
};

// The client is shared and memoized, created lazily on first search so the
// module has no import-time side effect (and a test that always passes its own
// client never touches the endpoint config).
let clientPromise: Promise<Client> | undefined;
const getClient = () => (clientPromise ??= getOpenSearchClient());

// A hit, typed by content type: the type it came from, its relevance score,
// and the indexed document (the caller narrows it to its type).
export interface SearchResult<T = Record<string, unknown>> {
  type: SearchType;
  score: number;
  document: T;
}

// Searches the given content types for the query and returns the hits merged
// and ordered by relevance. Each type runs in its own index with its own
// filter, in parallel: the fields differ per index (a module has no
// moduleVisibility, a course has no courseStatus), so one multi-index query
// cannot express the per-index filters. `scope` restricts a student's content
// to the courses they're enrolled in (see SearchScope); leave it unset for an
// instructor's or admin's unscoped search.
export const searchAcross = async ({
  query,
  types,
  size = 20,
  client,
  scope,
}: {
  query: string;
  types: readonly SearchType[];
  size?: number;
  client?: Client;
  scope?: SearchScope;
}): Promise<SearchResult[]> => {
  const opensearchClient = client ?? (await getClient());
  const perType = await Promise.all(
    types.map(async (type): Promise<SearchResult[]> => {
      const { indexName, matchFields, filter } = TYPE_SEARCHES[type](scope);
      const response = await opensearchClient.search({
        index: indexName,
        body: {
          size,
          query: {
            bool: {
              must: [{ multi_match: { query, fields: matchFields } }],
              // Users carry no filter clause; an empty {} would not parse as a
              // bool filter, so omit the key rather than send an empty clause.
              ...(Object.keys(filter).length > 0 ? { filter } : {}),
            },
          },
        },
      });
      const hits = (response.body?.hits?.hits ?? []) as Hit[];
      return hits.map((hit) => ({
        type,
        score: hit._score,
        document: hit._source,
      }));
    }),
  );
  return perType.flat().sort((a, b) => b.score - a.score);
};
