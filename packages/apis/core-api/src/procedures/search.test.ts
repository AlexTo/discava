/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { publicSearchCourses } from './search.js';

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

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

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(result).toEqual({
      items: [{ courseId: 'c1', title: 'Intro to DynamoDB' }],
      cursor: null,
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
});
