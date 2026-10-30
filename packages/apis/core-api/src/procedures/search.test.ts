/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { search } from './search.js';

// Captures what searchAcross is called with and returns a fixed course hit,
// so the test asserts on the scope and types the procedure passes down, not on
// a live collection.
const { db, searchAcrossMock } = vi.hoisted(() => ({
  db: { enrolments: [] as { courseId: string; status: string }[] },
  searchAcrossMock: vi.fn(),
}));

vi.mock('@discava/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/search')>()),
  searchAcross: searchAcrossMock,
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      enrolment: {
        query: {
          byUser: () => ({ go: async () => ({ data: db.enrolments }) }),
        },
      },
    },
  })),
}));

const courseHit = {
  type: 'course',
  score: 3,
  document: {
    id: 'c1',
    title: 'Algebra',
    status: 'published',
    searchText: 'Algebra',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
};

const caller = t.createCallerFactory(t.router({ search }));
const makeCall = (groups: string[]) =>
  caller({
    event: {
      requestContext: {
        authorizer: { claims: { sub: 'user-1', 'cognito:groups': groups } },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  }).search;

beforeEach(() => {
  db.enrolments = [];
  searchAcrossMock.mockReset();
  searchAcrossMock.mockResolvedValue([courseHit]);
});

describe('search (student)', () => {
  it('scopes content to the enrolments and drops the user type', async () => {
    db.enrolments = [
      { courseId: 'c1', status: 'active' },
      { courseId: 'c2', status: 'completed' },
      { courseId: 'c3', status: 'dropped' },
    ];
    const result = await makeCall(['student'])({
      query: 'algebra',
      types: ['course', 'user'],
    });

    const arg = searchAcrossMock.mock.calls[0][0];
    expect(arg.query).toBe('algebra');
    // The user type is dropped for a student even though they asked for it.
    expect(arg.types).toEqual(['course']);
    // Enrolled courses only: the dropped enrolment is out of scope.
    expect(arg.scope).toEqual({ courseIds: ['c1', 'c2'] });
    expect(arg.size).toBe(20);
    expect(result).toEqual({ results: [courseHit] });
  });

  it('scopes to no courses when the student has no enrolments', async () => {
    db.enrolments = [];
    await makeCall(['student'])({ query: 'algebra' });
    const arg = searchAcrossMock.mock.calls[0][0];
    expect(arg.scope).toEqual({ courseIds: [] });
    expect(arg.types).toEqual(['course', 'module', 'lesson', 'contentItem']);
  });
});

describe('search (instructor)', () => {
  it('is unscoped and may search every type', async () => {
    db.enrolments = [{ courseId: 'c1', status: 'active' }];
    await makeCall(['instructor'])({ query: 'algebra' });
    const arg = searchAcrossMock.mock.calls[0][0];
    // No scope: an instructor sees every published course's content.
    expect(arg.scope).toEqual({});
    // Enrolments do not scope an instructor's search.
    expect(arg.types).toEqual([
      'course',
      'module',
      'lesson',
      'contentItem',
      'user',
    ]);
  });

  it('returns an empty result when no type may be searched', async () => {
    // A student who asks only for the one type they cannot search.
    const result = await makeCall(['student'])({
      query: 'algebra',
      types: ['user'],
    });
    expect(searchAcrossMock).not.toHaveBeenCalled();
    expect(result).toEqual({ results: [] });
  });
});
