/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { myProgress } from './progress.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const { db, progressQuery } = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  progressQuery: vi.fn(),
}));

const stored = (name: string) => ({
  get: vi.fn(() => ({
    go: vi.fn(async () => ({ data: db[name] ?? null })),
  })),
});

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: stored('course'),
      enrolment: stored('enrolment'),
      progress: { query: { primary: progressQuery } },
    },
  })),
}));

const caller = t.createCallerFactory(t.router({ myProgress }));

const USER_SUB = 'student-1';

const callAsUser = () =>
  caller({
    event: {
      requestContext: { authorizer: { claims: { sub: USER_SUB } } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const progress = (lessonId: string, record: Record<string, unknown>) => ({
  userId: USER_SUB,
  courseId: 'course-1',
  lessonId,
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-03T00:00:00.000Z',
  ...record,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(db)) {
    delete db[key];
  }
  db.course = { courseId: 'course-1', status: 'published' };
  db.enrolment = { courseId: 'course-1', userId: USER_SUB, status: 'active' };
  progressQuery.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: [
        progress('lesson-1', {
          status: 'completed',
          completedAt: '2024-01-03T00:00:00.000Z',
        }),
        progress('lesson-2', { status: 'in_progress' }),
      ],
    }),
  });
});

describe('course.myProgress', () => {
  it("returns the caller's progress in each lesson of the course", async () => {
    await expect(
      callAsUser().myProgress({ courseId: 'course-1' }),
    ).resolves.toEqual({
      lessons: [
        {
          lessonId: 'lesson-1',
          status: 'completed',
          completedAt: '2024-01-03T00:00:00.000Z',
        },
        { lessonId: 'lesson-2', status: 'in_progress' },
      ],
    });
    // Only the caller's records, in this course, across every page.
    expect(progressQuery).toHaveBeenCalledWith({
      userId: USER_SUB,
      courseId: 'course-1',
    });
    expect(progressQuery.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
  });

  it.each([
    ['not enrolled', () => delete db.enrolment],
    ['dropped', () => (db.enrolment.status = 'dropped')],
  ])('is FORBIDDEN to a student who is %s', async (_, arrange) => {
    arrange();

    await expect(
      callAsUser().myProgress({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(progressQuery).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a course that doesn’t exist', async () => {
    delete db.course;

    await expect(
      callAsUser().myProgress({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects unauthenticated callers', async () => {
    const anonymous = caller({
      event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
      context: {} as any,
      info: {} as any,
    });

    await expect(
      anonymous.myProgress({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
