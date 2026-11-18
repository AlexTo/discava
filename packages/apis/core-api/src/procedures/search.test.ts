/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { errors as openSearchErrors } from '@opensearch-project/opensearch';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { publicSearchCourses } from './search.js';

const { searchMock, categoryQuery } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  categoryQuery: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: { category: { query: { primary: categoryQuery } } },
  })),
}));

vi.mock('@discava/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/search')>()),
  getOpenSearchClient: vi.fn(async () => ({ search: searchMock })),
}));

const router = t.router({ publicSearch: publicSearchCourses });
const caller = t.createCallerFactory(router);

const callAnonymously = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const esResponse = (hits: { _source: unknown }[], total = hits.length) => ({
  body: { hits: { hits, total: { value: total } } },
});

const category = (id: string, name: string, status = 'active') => ({
  categoryId: id,
  name,
  slug: name.toLowerCase(),
  status,
});

const noFacets = {
  categories: [],
  tags: [],
  levels: [],
  languages: [],
  durationBands: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  categoryQuery.mockReturnValue({ go: async () => ({ data: [] }) });
});

describe('course.publicSearch', () => {
  it('searches the courses index, filtered to published courses', async () => {
    searchMock.mockResolvedValue(
      esResponse([
        {
          _source: {
            courseId: 'c1',
            title: 'Intro to DynamoDB',
            status: 'published',
          },
        },
      ]),
    );

    const result = await callAnonymously().publicSearch({ q: 'dynamodb' });

    const [[request]] = searchMock.mock.calls;
    expect(request.index).toBe('courses');
    // Filtered in the query too, not only by what's indexed.
    expect(request.body.query.bool.filter).toEqual([
      { term: { status: 'published' } },
    ]);
    // Not every word has to match: the default `or` operator ranks by how
    // many do.
    expect(request.body.query.bool.must.multi_match).toMatchObject({
      type: 'cross_fields',
    });
    expect(request.body.query.bool.must.multi_match).not.toHaveProperty(
      'operator',
    );
    expect(result).toEqual({
      items: [{ courseId: 'c1', title: 'Intro to DynamoDB', tags: [] }],
      cursor: null,
      facets: noFacets,
    });
  });

  it('returns each course’s image key when it has one', async () => {
    searchMock.mockResolvedValue(
      esResponse([
        {
          _source: {
            courseId: 'c1',
            title: 'With image',
            imageKey: 'courses/c1/image.png',
            status: 'published',
          },
        },
        { _source: { courseId: 'c2', title: 'No image', status: 'published' } },
      ]),
    );

    const result = await callAnonymously().publicSearch({ q: 'image' });

    expect(result.items).toEqual([
      {
        courseId: 'c1',
        title: 'With image',
        imageKey: 'courses/c1/image.png',
        tags: [],
      },
      { courseId: 'c2', title: 'No image', tags: [] },
    ]);
  });

  it('gives the request a timeout shorter than the Lambda’s own', async () => {
    searchMock.mockResolvedValue(esResponse([]));

    await callAnonymously().publicSearch({ q: 'dynamodb' });

    const [, options] = searchMock.mock.calls[0];
    expect(options.requestTimeout).toBeGreaterThan(0);
  });

  it('turns a cold-start timeout into a clear, retriable error', async () => {
    searchMock.mockRejectedValue(
      new openSearchErrors.TimeoutError('Request timed out', {} as never),
    );

    await expect(
      callAnonymously().publicSearch({ q: 'dynamodb' }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('returns the next offset only when more results remain', async () => {
    searchMock.mockResolvedValue(
      esResponse([{ _source: { courseId: 'c1', title: 'A' } }], 5),
    );

    const result = await callAnonymously().publicSearch({
      q: 'a',
      limit: 1,
      cursor: 2,
    });

    expect(searchMock.mock.calls[0][0].body).toMatchObject({
      from: 2,
      size: 1,
    });
    expect(result.cursor).toBe(3);
  });

  it('browses without text', async () => {
    searchMock.mockResolvedValue(esResponse([]));

    await callAnonymously().publicSearch({});

    expect(searchMock.mock.calls[0][0].body.query.bool.must).toEqual({
      match_all: {},
    });
  });

  it('returns each hit with its category, tags, level, language and duration', async () => {
    categoryQuery.mockReturnValue({
      go: async () => ({ data: [category('cat-1', 'Science', 'archived')] }),
    });
    searchMock.mockResolvedValue(
      esResponse([
        {
          _source: {
            courseId: 'c1',
            title: 'A',
            categoryId: 'cat-1',
            tags: ['sql'],
            level: 'beginner',
            language: 'en',
            durationHours: 12,
          },
        },
      ]),
    );

    const result = await callAnonymously().publicSearch({});

    expect(result.items[0]).toEqual({
      courseId: 'c1',
      title: 'A',
      category: { id: 'cat-1', name: 'Science', slug: 'science' },
      tags: ['sql'],
      level: 'beginner',
      language: 'en',
      durationHours: 12,
    });
  });

  describe('facets', () => {
    const withAggregations = (aggregations: Record<string, unknown>) => ({
      body: {
        hits: { hits: [], total: { value: 0 } },
        aggregations,
      },
    });
    const values = (...buckets: [string | number, number][]) => ({
      values: {
        buckets: buckets.map(([key, doc_count]) => ({ key, doc_count })),
      },
    });

    it('maps buckets to names and drops archived and unknown categories', async () => {
      categoryQuery.mockReturnValue({
        go: async () => ({
          data: [
            category('cat-1', 'Science'),
            category('cat-2', 'Old', 'archived'),
          ],
        }),
      });
      searchMock.mockResolvedValue(
        withAggregations({
          categories: values(['cat-1', 4], ['cat-2', 3], ['ghost', 1]),
          tags: values(['sql', 2]),
          levels: values(['beginner', 3]),
          languages: values(['en', 5]),
          durationBands: values(['lt2', 1], ['2to10', 0], ['gt40', 2]),
        }),
      );

      const { facets } = await callAnonymously().publicSearch({});

      expect(facets.categories).toEqual([
        { id: 'cat-1', name: 'Science', slug: 'science', count: 4 },
      ]);
      expect(facets.tags).toEqual([{ value: 'sql', count: 2 }]);
      expect(facets.levels).toEqual([{ value: 'beginner', count: 3 }]);
      expect(facets.languages).toEqual([{ value: 'en', count: 5 }]);
      // Zero-count bands are left out; the rest keep band order.
      expect(facets.durationBands).toEqual([
        { value: 'lt2', count: 1 },
        { value: 'gt40', count: 2 },
      ]);
    });

    it('lists selected values even with a zero count', async () => {
      categoryQuery.mockReturnValue({
        go: async () => ({ data: [category('cat-1', 'Science')] }),
      });
      searchMock.mockResolvedValue(withAggregations({}));

      const { facets } = await callAnonymously().publicSearch({
        categoryId: 'cat-1',
        tags: ['sql'],
        levels: ['advanced'],
        languages: ['fr'],
        durationBands: ['gt40'],
      });

      expect(facets.categories).toEqual([
        { id: 'cat-1', name: 'Science', slug: 'science', count: 0 },
      ]);
      expect(facets.tags).toEqual([{ value: 'sql', count: 0 }]);
      expect(facets.levels).toEqual([{ value: 'advanced', count: 0 }]);
      expect(facets.languages).toEqual([{ value: 'fr', count: 0 }]);
      expect(facets.durationBands).toEqual([{ value: 'gt40', count: 0 }]);
    });

    it('returns no items and no error for unknown filter values', async () => {
      searchMock.mockResolvedValue(withAggregations({}));

      const result = await callAnonymously().publicSearch({
        levels: ['expert'],
        durationBands: ['forever'],
        categoryId: 'nope',
      });

      expect(result.items).toEqual([]);
      expect(result.cursor).toBeNull();
    });
  });
});
