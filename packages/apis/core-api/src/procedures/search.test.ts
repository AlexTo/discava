/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { query } from './search.js';

const { enrolmentQueryByUser, searchMock } = vi.hoisted(() => ({
  enrolmentQueryByUser: vi.fn(),
  searchMock: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      enrolment: { query: { byUser: enrolmentQueryByUser } },
    },
  })),
}));

vi.mock('@discava/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/search')>()),
  getOpenSearchClient: vi.fn(async () => ({ search: searchMock })),
}));

const router = t.router({ query });
const caller = t.createCallerFactory(router);

const USER_SUB = 'user-1';

const buildEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: { authorizer: { claims: { sub: USER_SUB } } },
  }) as unknown as APIGatewayProxyEvent;

const callAsUser = () =>
  caller({ event: buildEvent(), context: {} as any, info: {} as any });

const callAnonymously = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const esResponse = (hits: { _index: string; _source: unknown }[]) => ({
  body: { hits: { hits, total: { value: hits.length } } },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('search.query', () => {
  it('searches only courses for an anonymous caller', async () => {
    searchMock.mockResolvedValue(
      esResponse([
        {
          _index: 'courses',
          _source: { courseId: 'c1', title: 'Intro to DynamoDB' },
        },
      ]),
    );

    const result = await callAnonymously().query({ q: 'dynamodb' });

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: ['courses'] }),
    );
    expect(enrolmentQueryByUser).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      { type: 'course', courseId: 'c1', title: 'Intro to DynamoDB' },
    ]);
  });

  it('includes lessons from the caller’s own enrolled courses when signed in', async () => {
    enrolmentQueryByUser.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: 'c1', status: 'active' },
          { courseId: 'c2', status: 'dropped' },
        ],
      }),
    });
    searchMock.mockResolvedValue(
      esResponse([
        {
          _index: 'lessons',
          _source: {
            lessonId: 'l1',
            moduleId: 'm1',
            courseId: 'c1',
            title: 'Partition keys',
          },
        },
      ]),
    );

    const result = await callAsUser().query({ q: 'partition' });

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: ['courses', 'lessons'] }),
    );
    const [[request]] = searchMock.mock.calls;
    // Only the caller's non-dropped courses scope the lessons filter -- a
    // dropped enrolment grants no search access to that course's lessons.
    expect(request.body.query.bool.filter.bool.should).toContainEqual(
      expect.objectContaining({
        bool: expect.objectContaining({
          filter: expect.arrayContaining([{ terms: { courseId: ['c1'] } }]),
        }),
      }),
    );
    expect(result.items).toEqual([
      {
        type: 'lesson',
        lessonId: 'l1',
        moduleId: 'm1',
        courseId: 'c1',
        title: 'Partition keys',
      },
    ]);
  });

  it('excludes lessons entirely for a signed-in caller with no active enrolments', async () => {
    enrolmentQueryByUser.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [] }),
    });
    searchMock.mockResolvedValue(esResponse([]));

    await callAsUser().query({ q: 'anything' });

    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ index: ['courses'] }),
    );
  });

  it('returns the next offset only when more results remain', async () => {
    searchMock.mockResolvedValue(
      esResponse([
        { _index: 'courses', _source: { courseId: 'c1', title: 'A' } },
      ]),
    );
    searchMock.mockResolvedValueOnce({
      body: {
        hits: {
          hits: [
            { _index: 'courses', _source: { courseId: 'c1', title: 'A' } },
          ],
          total: { value: 5 },
        },
      },
    });

    const result = await callAnonymously().query({ q: 'a', limit: 1 });

    expect(result.cursor).toBe(1);
  });
});
