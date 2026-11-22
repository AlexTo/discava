/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { listGradingQueue } from './grading-queue.js';

const {
  courseInstructorQueryByInstructor,
  assignmentSubmissionQueryByWaiting,
  enrolmentGet,
  courseGet,
  userGet,
  contentItemQueryPrimary,
  lessonGet,
  mockModule,
} = await vi.hoisted(async () => ({
  ...(await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
    courseInstructor: ['query.byInstructor'],
    assignmentSubmission: ['query.byWaiting'],
    enrolment: ['get'],
    course: ['get'],
    user: ['get'],
    contentItem: ['query.primary'],
    lesson: ['get'],
  }),
}));

vi.mock('@discava/core-table', async (importActual) =>
  mockModule(await importActual()),
);

const router = t.router({ list: listGradingQueue });
const call = () =>
  callerFor(router, { sub: 'instructor-1', groups: ['instructor'] });

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

const waiting = (
  courseId: string,
  userId: string,
  waitingSince: string,
  contentItemId = 'item-1',
) => ({
  courseId,
  contentItemId,
  userId,
  submittedAt: waitingSince,
  waitingSince,
  late: false,
});

const item = (courseId: string) => ({
  courseId,
  moduleId: 'm',
  lessonId: `lesson-${courseId}`,
  contentItemId: 'item-1',
  type: 'assignment',
});

beforeEach(() => {
  vi.resetAllMocks();
  courseInstructorQueryByInstructor.mockReturnValue(
    resolves([{ courseId: 'c1' }, { courseId: 'c2' }]),
  );
  assignmentSubmissionQueryByWaiting.mockImplementation(
    ({ waitingCourseId }: { waitingCourseId: string }) =>
      resolves(
        waitingCourseId === 'c1'
          ? [
              waiting('c1', 'u1', '2026-11-03T00:00:00.000Z'),
              waiting('c1', 'u3', '2026-11-05T00:00:00.000Z'),
            ]
          : [waiting('c2', 'u2', '2026-11-04T00:00:00.000Z')],
      ),
  );
  enrolmentGet.mockImplementation(
    (keys: { courseId: string; userId: string }[]) =>
      resolves(keys.map((key) => ({ ...key, status: 'active' }))),
  );
  courseGet.mockImplementation((keys: { courseId: string }[]) =>
    resolves(
      keys.map(({ courseId }) => ({ courseId, title: `Course ${courseId}` })),
    ),
  );
  userGet.mockImplementation((keys: { userId: string }[]) =>
    resolves(
      keys.map(({ userId }) => ({ userId, displayName: `Name ${userId}` })),
    ),
  );
  contentItemQueryPrimary.mockImplementation(
    ({ courseId }: { courseId: string }) => resolves([item(courseId)]),
  );
  lessonGet.mockImplementation(
    (keys: { courseId: string; lessonId: string }[]) =>
      resolves(
        keys.map(({ courseId, lessonId }) => ({
          courseId,
          lessonId,
          title: `Essay ${courseId}`,
        })),
      ),
  );
});

describe('gradingQueue.list', () => {
  it('merges two courses oldest first, with titles and names', async () => {
    const result = await call().list({});
    expect(result.total).toBe(3);
    expect(result.items.map(({ userId }) => userId)).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(result.items[1]).toMatchObject({
      courseId: 'c2',
      courseTitle: 'Course c2',
      assignmentTitle: 'Essay c2',
      contentItemId: 'item-1',
      submittedAt: '2026-11-04T00:00:00.000Z',
      late: false,
    });
  });

  it('leaves out students who dropped, from items and the total', async () => {
    enrolmentGet.mockImplementation(
      (keys: { courseId: string; userId: string }[]) =>
        resolves(
          keys.map((key) => ({
            ...key,
            status: key.userId === 'u1' ? 'dropped' : 'active',
          })),
        ),
    );
    const result = await call().list({});
    expect(result.total).toBe(2);
    expect(result.items.map(({ userId }) => userId)).toEqual(['u2', 'u3']);
  });

  it('lists a student waiting on two assignments of one course', async () => {
    // DynamoDB refuses a batch get whose keys repeat.
    const refusingDuplicates =
      (key: (k: Record<string, string>) => string, data: unknown) =>
      (keys: Record<string, string>[]) => {
        const seen = new Set(keys.map(key));
        return seen.size === keys.length
          ? resolves(data ?? keys.map((k) => ({ ...k, status: 'active' })))
          : { go: vi.fn().mockRejectedValue(new Error('duplicates')) };
      };
    courseInstructorQueryByInstructor.mockReturnValue(
      resolves([{ courseId: 'c1' }]),
    );
    assignmentSubmissionQueryByWaiting.mockReturnValue(
      resolves([
        waiting('c1', 'u1', '2026-11-03T00:00:00.000Z', 'item-1'),
        waiting('c1', 'u1', '2026-11-04T00:00:00.000Z', 'item-2'),
      ]),
    );
    enrolmentGet.mockImplementation(
      refusingDuplicates(({ courseId, userId }) => `${courseId}#${userId}`),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([item('c1'), { ...item('c1'), contentItemId: 'item-2' }]),
    );
    lessonGet.mockImplementation(
      refusingDuplicates(
        ({ courseId, lessonId }) => `${courseId}#${lessonId}`,
        [{ courseId: 'c1', lessonId: 'lesson-c1', title: 'Essay c1' }],
      ),
    );

    const result = await call().list({});
    expect(result.total).toBe(2);
    expect(result.items.map(({ contentItemId }) => contentItemId)).toEqual([
      'item-1',
      'item-2',
    ]);
    expect(result.items[1]).toMatchObject({
      userId: 'u1',
      assignmentTitle: 'Essay c1',
    });
  });

  it('limits the items but counts every waiting entry', async () => {
    const result = await call().list({ limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it('rejects a limit over 50', async () => {
    await expect(call().list({ limit: 51 })).rejects.toThrow();
  });

  it('is empty for an instructor with no courses', async () => {
    courseInstructorQueryByInstructor.mockReturnValue(resolves([]));
    expect(await call().list({})).toEqual({ total: 0, items: [] });
    expect(assignmentSubmissionQueryByWaiting).not.toHaveBeenCalled();
  });
});
