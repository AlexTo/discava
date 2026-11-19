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
    expect(
      request.body.query.bool.must.function_score.query.multi_match,
    ).toMatchObject({
      type: 'cross_fields',
    });
    expect(
      request.body.query.bool.must.function_score.query.multi_match,
    ).not.toHaveProperty('operator');
    expect(result).toEqual({
      items: [
        {
          courseId: 'c1',
          title: 'Intro to DynamoDB',
          ratingCount: 0,
          tags: [],
        },
      ],
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
        ratingCount: 0,
        tags: [],
      },
      { courseId: 'c2', title: 'No image', ratingCount: 0, tags: [] },
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
      ratingCount: 0,
    });
  });

  it('returns a hit’s price, and no price for one indexed before it had one', async () => {
    searchMock.mockResolvedValue(
      esResponse([
        {
          _source: {
            courseId: 'c1',
            title: 'A',
            priceAmount: 1999,
            priceCurrency: 'EUR',
          },
        },
        { _source: { courseId: 'c2', title: 'B' } },
      ]),
    );

    const { items } = await callAnonymously().publicSearch({});

    expect(items[0]).toMatchObject({ priceAmount: 1999, priceCurrency: 'EUR' });
    expect(items[1]).not.toHaveProperty('priceAmount');
  });

  it('returns a hit’s rating when it has one, and a count of 0 when not', async () => {
    searchMock.mockResolvedValue(
      esResponse([
        {
          _source: {
            courseId: 'c1',
            title: 'A',
            ratingCount: 128,
            ratingAverage: 4.6,
            ratingScore: 4.5,
            ratingBoost: 1.1,
          },
        },
        { _source: { courseId: 'c2', title: 'B', ratingBoost: 1 } },
      ]),
    );

    const { items } = await callAnonymously().publicSearch({});

    expect(items[0]).toMatchObject({ ratingAverage: 4.6, ratingCount: 128 });
    expect(items[0]).not.toHaveProperty('ratingScore');
    expect(items[0]).not.toHaveProperty('ratingBoost');
    expect(items[1]).toMatchObject({ ratingCount: 0 });
    expect(items[1]).not.toHaveProperty('ratingAverage');
  });

  describe('sort and minRating', () => {
    const bodyOf = async (input: Record<string, unknown>) => {
      searchMock.mockResolvedValue(esResponse([]));
      await callAnonymously().publicSearch(input as never);
      return searchMock.mock.calls[0][0].body;
    };

    it('multiplies a text query’s score by the rating boost by default', async () => {
      const body = await bodyOf({ q: 'sql' });

      expect(body.query.bool.must).toEqual({
        function_score: {
          query: expect.objectContaining({ multi_match: expect.anything() }),
          field_value_factor: { field: 'ratingBoost', missing: 1 },
          boost_mode: 'multiply',
        },
      });
      expect(body.sort).toBeUndefined();
    });

    it('sorts by rating score, unrated last, then newest, then id', async () => {
      const body = await bodyOf({ q: 'sql', sort: 'rating' });

      expect(body.sort).toEqual([
        { ratingScore: { order: 'desc', missing: '_last' } },
        { publishedAt: 'desc' },
        { courseId: 'asc' },
      ]);
      expect(body.query.bool.must.function_score).toBeUndefined();
    });

    it('sorts by newest then id', async () => {
      const body = await bodyOf({ q: 'sql', sort: 'newest' });

      expect(body.sort).toEqual([{ publishedAt: 'desc' }, { courseId: 'asc' }]);
      expect(body.query.bool.must.function_score).toBeUndefined();
    });

    it.each([4.5, 4, 3.5, 3])(
      'filters to an average of at least %s beside the published filter',
      async (minRating) => {
        const body = await bodyOf({ minRating });

        expect(body.query.bool.filter).toEqual([
          { term: { status: 'published' } },
          { range: { ratingAverage: { gte: minRating } } },
        ]);
      },
    );

    it('has no rating filter without minRating', async () => {
      const body = await bodyOf({});

      expect(body.query.bool.filter).toEqual([
        { term: { status: 'published' } },
      ]);
    });

    it.each([
      { sort: 'popular' },
      { minRating: 5 },
      { minRating: 2 },
      { minRating: '4' },
    ])('refuses %o', async (input) => {
      await expect(
        callAnonymously().publicSearch(input as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(searchMock).not.toHaveBeenCalled();
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
