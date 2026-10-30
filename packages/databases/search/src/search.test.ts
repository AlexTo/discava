/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Client } from '@opensearch-project/opensearch';
import { describe, expect, it } from 'vitest';
import { SEARCH_TYPES, type SearchType, searchAcross } from './search.js';

// A stub client: records the queries it is asked to run and answers each with
// a fixed set of hits, so the merge and sort in searchAcross are testable
// without a live collection.
type Stub = { calls: { index: string; body: unknown }[] } & {
  search: (params: { index: string; body: unknown }) => Promise<{
    body: {
      hits: { hits: { _score: number; _source: Record<string, unknown> }[] };
    };
  }>;
};

const makeStub = (
  perIndex: Record<
    string,
    { _score: number; _source: Record<string, unknown> }[]
  >,
): Stub => {
  const stub: Stub = {
    calls: [],
    search: async (params) => {
      stub.calls.push(params);
      return { body: { hits: { hits: perIndex[params.index] ?? [] } } };
    },
  };
  return stub;
};
const stub = makeStub({});

describe('searchAcross', () => {
  it('searches only the requested types', async () => {
    stub.calls.length = 0;
    await searchAcross({
      query: 'algebra',
      types: ['course', 'user'],
      client: stub as unknown as Client,
    });
    expect(stub.calls.map((c) => c.index).sort()).toEqual(['courses', 'users']);
  });

  it('merges hits across types and orders them by score', async () => {
    stub.calls.length = 0;
    const client = makeStub({
      courses: [
        { _score: 5, _source: { id: 'c1' } },
        { _score: 2, _source: { id: 'c2' } },
      ],
      lessons: [{ _score: 9, _source: { id: 'l1' } }],
    });
    const results = await searchAcross({
      query: 'algebra',
      types: ['course', 'lesson'],
      client: client as unknown as Client,
    });
    expect(results).toEqual([
      { type: 'lesson', score: 9, document: { id: 'l1' } },
      { type: 'course', score: 5, document: { id: 'c1' } },
      { type: 'course', score: 2, document: { id: 'c2' } },
    ]);
  });

  it('returns nothing when a type has no hits', async () => {
    const client = makeStub({ courses: [], users: [] });
    const results = await searchAcross({
      query: 'nothing',
      types: ['course', 'user'],
      client: client as unknown as Client,
    });
    expect(results).toEqual([]);
  });

  it('filters out hidden, archived and unpublished content per index', async () => {
    stub.calls.length = 0;
    await searchAcross({
      query: 'x',
      types: [...SEARCH_TYPES],
      client: stub as unknown as Client,
    });
    const byIndex = Object.fromEntries(
      stub.calls.map((c) => [c.index, c.body]),
    );
    const filterOf = (index: string) =>
      (byIndex[index] as { query: { bool: { filter: unknown } } }).query.bool
        .filter;

    // Courses: published only (no visibility flags on a course doc).
    expect(filterOf('courses')).toEqual({ term: { status: 'published' } });

    // A module: visible, not archived, and its course published.
    expect(filterOf('modules')).toEqual({
      bool: {
        filter: [
          { term: { visibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
          { term: { courseStatus: 'published' } },
        ],
      },
    });

    // A lesson: also its module's visibility and archive state.
    expect(filterOf('lessons')).toEqual({
      bool: {
        filter: [
          { term: { visibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
          { term: { moduleVisibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'moduleArchivedAt' } }] } },
          { term: { courseStatus: 'published' } },
        ],
      },
    });

    // A content item: also its lesson's visibility and archive state.
    expect(filterOf('content-items')).toEqual({
      bool: {
        filter: [
          { term: { visibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
          { term: { lessonVisibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'lessonArchivedAt' } }] } },
          { term: { courseStatus: 'published' } },
        ],
      },
    });

    // Users carry no visibility flags: the API decides who may search them,
    // so the users query has no filter clause at all (an empty {} would not
    // parse as a bool filter).
    const usersBool = (
      byIndex['users'] as {
        query: { bool: { filter?: unknown } };
      }
    ).query.bool;
    expect(usersBool.filter).toBeUndefined();
  });

  it('matches the folded searchText and title fields for content', async () => {
    stub.calls.length = 0;
    await searchAcross({
      query: 'x',
      types: ['course', 'lesson'] as SearchType[],
      client: stub as unknown as Client,
    });
    const byIndex = Object.fromEntries(
      stub.calls.map((c) => [c.index, c.body]),
    );
    const mustOf = (index: string) =>
      (byIndex[index] as { query: { bool: { must: unknown[] } } }).query.bool
        .must;
    expect(mustOf('courses')).toEqual([
      { multi_match: { query: 'x', fields: ['searchText', 'title'] } },
    ]);
    expect(mustOf('lessons')).toEqual([
      { multi_match: { query: 'x', fields: ['searchText', 'title'] } },
    ]);
  });

  it('scopes content to the caller enrolled courses, not courses themselves', async () => {
    stub.calls.length = 0;
    await searchAcross({
      query: 'x',
      types: ['course', 'module', 'lesson', 'contentItem', 'user'],
      client: stub as unknown as Client,
      scope: { courseIds: ['c1', 'c2'] },
    });
    const byIndex = Object.fromEntries(
      stub.calls.map((c) => [c.index, c.body]),
    );
    const filterOf = (index: string) =>
      (byIndex[index] as { query: { bool: { filter: unknown } } }).query.bool
        .filter;

    // A student may search any published course and enrol from the result, so
    // the course query carries no scope. Users carry no scope or filter, so
    // their query has no filter clause at all (an empty {} would not parse as
    // a bool filter).
    expect(filterOf('courses')).toEqual({ term: { status: 'published' } });
    expect(
      (byIndex['users'] as { query: { bool: { filter?: unknown } } }).query.bool
        .filter,
    ).toBeUndefined();

    // A course's content is in range only when the student is enrolled in it;
    // the last clause of each content filter is the enrolment scope.
    expect(filterOf('modules')).toEqual({
      bool: {
        filter: [
          { term: { visibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
          { term: { courseStatus: 'published' } },
          { terms: { courseId: ['c1', 'c2'] } },
        ],
      },
    });
    expect(filterOf('lessons')).toEqual({
      bool: {
        filter: [
          { term: { visibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
          { term: { moduleVisibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'moduleArchivedAt' } }] } },
          { term: { courseStatus: 'published' } },
          { terms: { courseId: ['c1', 'c2'] } },
        ],
      },
    });
    expect(filterOf('content-items')).toEqual({
      bool: {
        filter: [
          { term: { visibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'archivedAt' } }] } },
          { term: { lessonVisibility: 'visible' } },
          { bool: { must_not: [{ exists: { field: 'lessonArchivedAt' } }] } },
          { term: { courseStatus: 'published' } },
          { terms: { courseId: ['c1', 'c2'] } },
        ],
      },
    });
  });

  it('lets an unenrolled student see no content', async () => {
    stub.calls.length = 0;
    await searchAcross({
      query: 'x',
      types: ['lesson'],
      client: stub as unknown as Client,
      scope: { courseIds: [] },
    });
    const clauses = (
      stub.calls[0].body as {
        query: { bool: { filter: { bool: { filter: unknown[] } } } };
      }
    ).query.bool.filter.bool.filter;
    // A terms over no course ids matches nothing.
    expect(clauses).toEqual(
      expect.arrayContaining([{ terms: { courseId: [] } }]),
    );
  });
});
