/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  archiveCourse,
  createCourse,
  publishCourse,
  restoreCourse,
  viewCourse,
} from './course.js';

const {
  courseCreate,
  courseGet,
  coursePatch,
  coursePatchSet,
  coursePatchWhere,
  coursePatchGo,
  coursePatchCommit,
  moduleCheck,
  lessonCheck,
  contentItemCheck,
  courseInstructorCreate,
  courseInstructorGet,
  courseInstructorQueryPrimary,
  courseInstructorPatch,
  courseInstructorPatchSet,
  transactionWrite,
  transactionGo,
  curriculumCollection,
} = vi.hoisted(() => ({
  courseCreate: vi.fn(),
  courseGet: vi.fn(),
  coursePatch: vi.fn(),
  coursePatchSet: vi.fn(),
  coursePatchWhere: vi.fn(),
  coursePatchGo: vi.fn(),
  coursePatchCommit: vi.fn(),
  moduleCheck: vi.fn(),
  lessonCheck: vi.fn(),
  contentItemCheck: vi.fn(),
  courseInstructorCreate: vi.fn(),
  courseInstructorGet: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseInstructorPatch: vi.fn(),
  courseInstructorPatchSet: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  curriculumCollection: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: {
        create: courseCreate,
        get: courseGet,
        patch: coursePatch,
      },
      courseInstructor: {
        create: courseInstructorCreate,
        get: courseInstructorGet,
        query: {
          primary: courseInstructorQueryPrimary,
        },
        patch: courseInstructorPatch,
      },
    },
    transaction: {
      write: transactionWrite,
    },
    collections: {
      curriculum: curriculumCollection,
    },
  })),
}));

const router = t.router({
  createCourse,
  archiveCourse,
  publishCourse,
  restoreCourse,
  viewCourse,
});
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const course = {
  courseId: 'course-1',
  title: 'Intro to DynamoDB',
  status: 'draft' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

type CheckCondition = (
  attr: Record<string, string>,
  op: Record<string, (...args: string[]) => string>,
) => string;

// The `where` callback each guard in the publish transaction was given.
const checkConditions: Record<string, CheckCondition> = {};

beforeEach(() => {
  vi.clearAllMocks();

  courseCreate.mockImplementation((attrs) => ({
    commit: () => ({ item: null, attrs }),
  }));
  courseInstructorCreate.mockImplementation((attrs) => ({
    commit: () => ({ item: null, attrs }),
  }));
  transactionWrite.mockImplementation((fn) => {
    fn({
      course: { create: courseCreate, patch: coursePatch },
      courseInstructor: { create: courseInstructorCreate },
      module: { check: moduleCheck },
      lesson: { check: lessonCheck },
      contentItem: { check: contentItemCheck },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: course }),
  });

  coursePatch.mockReturnValue({ set: coursePatchSet });
  // The result of whichever patch a test runs; archive's default.
  coursePatchGo.mockResolvedValue({ data: { ...course, status: 'archived' } });
  coursePatchSet.mockReturnValue({
    go: coursePatchGo,
    where: coursePatchWhere,
  });
  coursePatchWhere.mockReturnValue({
    go: coursePatchGo,
    commit: coursePatchCommit,
  });
  // A guard on a record the course's visible content depends on; the
  // `where` callbacks are kept so tests can read the condition.
  for (const [name, check] of Object.entries({
    module: moduleCheck,
    lesson: lessonCheck,
    contentItem: contentItemCheck,
  })) {
    check.mockImplementation(() => ({
      where: (condition: CheckCondition) => {
        checkConditions[name] = condition;
        return { commit: () => ({}) };
      },
    }));
  }
  curriculumCollection.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { course: [course], ...visibleCurriculum },
    }),
  });
  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
    }),
  });
  courseInstructorQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: [{ courseId: course.courseId, instructorId: INSTRUCTOR_SUB }],
    }),
  });
  courseInstructorPatch.mockReturnValue({ set: courseInstructorPatchSet });
  courseInstructorPatchSet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: undefined }),
  });
});

describe('createCourse', () => {
  it('rejects callers who are not in the instructor group', async () => {
    await expect(
      callAs(['student']).createCourse({ title: 'Intro' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // Invariant: a course must never exist without at least one instructor.
  // That's only guaranteed if both writes are enqueued inside the same
  // transaction, rather than as two independent, individually-failable calls.
  it('creates the course and its initial CourseInstructor row in a single transaction', async () => {
    await callAs().createCourse({
      title: 'Intro to DynamoDB',
      description: 'desc',
    });

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(courseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Intro to DynamoDB',
        description: 'desc',
      }),
    );
    expect(courseInstructorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId: INSTRUCTOR_SUB,
        courseUpdatedAt: expect.any(String),
      }),
    );

    const [courseArgs] = courseCreate.mock.calls[0];
    const [instructorArgs] = courseInstructorCreate.mock.calls[0];
    expect(instructorArgs.courseId).toBe(courseArgs.courseId);
  });

  it('returns the course fetched after the transaction commits', async () => {
    const result = await callAs().createCourse({ title: 'Intro to DynamoDB' });
    expect(result).toEqual(course);
  });

  // Invariant: courseInstructor.courseUpdatedAt is the course's updatedAt.
  it("copies the course's updatedAt to its instructor when the clock ticked between them", async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2023-12-31') });
    try {
      await callAs().createCourse({ title: 'Intro to DynamoDB' });
    } finally {
      vi.useRealTimers();
    }

    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: courseCreate.mock.calls[0][0].courseId,
      instructorId: INSTRUCTOR_SUB,
    });
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: course.updatedAt,
    });
  });

  it('writes nothing more when the timestamps already match', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(course.updatedAt) });
    try {
      await callAs().createCourse({ title: 'Intro to DynamoDB' });
    } finally {
      vi.useRealTimers();
    }

    expect(courseInstructorPatch).not.toHaveBeenCalled();
  });

  it('throws INTERNAL_SERVER_ERROR when the transaction is canceled', async () => {
    transactionGo.mockResolvedValue({ canceled: true, data: [] });

    await expect(
      callAs().createCourse({ title: 'Intro to DynamoDB' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(courseGet).not.toHaveBeenCalled();
  });

  it('throws INTERNAL_SERVER_ERROR when the course cannot be found after a successful transaction', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createCourse({ title: 'Intro to DynamoDB' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
});

describe('archiveCourse', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).archiveCourse({ courseId: course.courseId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  // Invariant: only an instructor who actually teaches the course may
  // archive it -- membership in the `instructor` group is not enough.
  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().archiveCourse({ courseId: course.courseId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(coursePatch).not.toHaveBeenCalled();
    expect(courseInstructorQueryPrimary).not.toHaveBeenCalled();
  });

  it('archives a course the caller teaches', async () => {
    const result = await callAs().archiveCourse({ courseId: course.courseId });

    expect(courseInstructorGet).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: INSTRUCTOR_SUB,
    });
    expect(coursePatch).toHaveBeenCalledWith({ courseId: course.courseId });
    expect(coursePatchSet).toHaveBeenCalledWith({ status: 'archived' });
    expect(result).toEqual({ ...course, status: 'archived' });
  });

  // byInstructor's sort key is courseUpdatedAt#courseId, so every
  // CourseInstructor row for the course needs the refreshed timestamp, not
  // just the caller's own membership row.
  it('refreshes the denormalized courseUpdatedAt on every instructor teaching the course', async () => {
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
          { courseId: course.courseId, instructorId: 'co-instructor' },
        ],
      }),
    });

    await callAs().archiveCourse({ courseId: course.courseId });

    expect(courseInstructorQueryPrimary).toHaveBeenCalledWith({
      courseId: course.courseId,
    });
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: INSTRUCTOR_SUB,
    });
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: 'co-instructor',
    });
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: course.updatedAt,
    });
    expect(courseInstructorPatchSet).toHaveBeenCalledTimes(2);
  });
});

// A module, lesson and content item that students would see.
const visibleCurriculum = {
  module: [{ moduleId: 'm1', visibility: 'visible' }],
  lesson: [{ lessonId: 'l1', moduleId: 'm1', visibility: 'visible' }],
  contentItem: [
    {
      contentItemId: 'c1',
      lessonId: 'l1',
      moduleId: 'm1',
      visibility: 'visible',
    },
  ],
};

const conditionalCheckFailed = () =>
  Object.assign(new Error('ElectroDB error'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

const givenCourse = (data: Record<string, unknown>) =>
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { ...course, ...data } }),
  });

// Runs the `where` callback the way ElectroDB would, returning the condition.
const conditionOf = () => {
  const condition = coursePatchWhere.mock.calls[0][0] as (
    attr: Record<string, string>,
    op: Record<string, (...args: string[]) => string>,
  ) => string;
  return condition(
    { status: 'status' },
    { eq: (attribute, value) => `${attribute} = ${value}` },
  );
};

const conditionText = (condition: CheckCondition) =>
  condition(
    { visibility: 'visibility', archivedAt: 'archivedAt' },
    {
      eq: (attribute, value) => `${attribute} = ${value}`,
      notExists: (attribute) => `attribute_not_exists(${attribute})`,
    },
  );

// The course reads as a draft, then (once the transaction commits) as published.
const givenPublishCommits = (published: Record<string, unknown>) =>
  courseGet
    .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: course }) })
    .mockReturnValueOnce({
      go: vi.fn().mockResolvedValue({
        data: { ...course, status: 'published', ...published },
      }),
    });

describe('publishCourse', () => {
  const input = { courseId: course.courseId };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).publishCourse(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the course does not exist', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('publishes a draft course that has content, recording when', async () => {
    givenPublishCommits({ publishedAt: '2024-02-01T00:00:00.000Z' });

    const result = await callAs().publishCourse(input);

    expect(coursePatchSet).toHaveBeenCalledWith({
      status: 'published',
      publishedAt: expect.any(String),
    });
    // Only a draft may be published, even if the course changes between the
    // read and the write.
    expect(conditionOf()).toBe('status = draft');
    expect(result).toMatchObject({ status: 'published' });
  });

  // Invariant: the course can't be published empty, even if its last visible
  // content is deleted, hidden or archived after the check.
  it('writes in one transaction guarded by a visible content item and its lesson and module', async () => {
    givenPublishCommits({});

    await callAs().publishCourse(input);

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(moduleCheck).toHaveBeenCalledWith({
      courseId: course.courseId,
      moduleId: 'm1',
    });
    expect(lessonCheck).toHaveBeenCalledWith({
      courseId: course.courseId,
      moduleId: 'm1',
      lessonId: 'l1',
    });
    expect(contentItemCheck).toHaveBeenCalledWith({
      courseId: course.courseId,
      moduleId: 'm1',
      lessonId: 'l1',
      contentItemId: 'c1',
    });
    const guard = 'visibility = visible AND attribute_not_exists(archivedAt)';
    for (const name of ['module', 'lesson', 'contentItem']) {
      expect(conditionText(checkConditions[name])).toBe(guard);
    }
  });

  it('refuses to publish a course with no content items, without writing', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: visibleCurriculum.module,
          lesson: visibleCurriculum.lesson,
          contentItem: [],
        },
      }),
    });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  // Publishing the course doesn't change its records, so content that is
  // hidden, archived, or under a hidden or archived module or lesson doesn't
  // make the course worth publishing.
  it.each([
    ['hidden', { contentItem: { visibility: 'hidden' } }],
    ['archived', { contentItem: { archivedAt: '2024-02-01T00:00:00.000Z' } }],
    ['under a hidden lesson', { lesson: { visibility: 'hidden' } }],
    [
      'under an archived lesson',
      { lesson: { archivedAt: '2024-02-01T00:00:00.000Z' } },
    ],
    ['under a hidden module', { module: { visibility: 'hidden' } }],
    [
      'under an archived module',
      { module: { archivedAt: '2024-02-01T00:00:00.000Z' } },
    ],
  ])('refuses to publish when the only content is %s', async (_, change) => {
    const { module, lesson, contentItem } = visibleCurriculum;
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [{ ...module[0], ...('module' in change && change.module) }],
          lesson: [{ ...lesson[0], ...('lesson' in change && change.lesson) }],
          contentItem: [
            {
              ...contentItem[0],
              ...('contentItem' in change && change.contentItem),
            },
          ],
        },
      }),
    });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('publishes when at least one content item is visible, even if others are hidden', async () => {
    const { module, lesson, contentItem } = visibleCurriculum;
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module,
          lesson,
          contentItem: [
            {
              ...contentItem[0],
              contentItemId: 'hidden',
              visibility: 'hidden',
            },
            contentItem[0],
          ],
        },
      }),
    });

    await callAs().publishCourse(input);

    expect(coursePatch).toHaveBeenCalled();
    // The transaction guards the visible item, not the hidden one listed first.
    expect(contentItemCheck).toHaveBeenCalledWith(
      expect.objectContaining({ contentItemId: 'c1' }),
    );
    expect(contentItemCheck).not.toHaveBeenCalledWith(
      expect.objectContaining({ contentItemId: 'hidden' }),
    );
  });

  it('reads every page of the curriculum when counting content', async () => {
    await callAs().publishCourse(input);

    expect(curriculumCollection.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
  });

  it('refuses to publish an archived course and says to restore it', async () => {
    givenCourse({ status: 'archived' });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course before publishing it',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('writes nothing when the course is already published', async () => {
    givenCourse({
      status: 'published',
      publishedAt: '2024-02-01T00:00:00.000Z',
    });

    const result = await callAs().publishCourse(input);

    expect(result).toMatchObject({ status: 'published' });
    expect(coursePatch).not.toHaveBeenCalled();
    expect(courseInstructorPatch).not.toHaveBeenCalled();
  });

  const canceledWith = (...codes: (string | undefined)[]) =>
    transactionGo.mockResolvedValue({
      canceled: true,
      data: codes.map((code) => (code ? { code } : {})),
    });

  it('succeeds when another request published it between the read and the write', async () => {
    canceledWith('ConditionalCheckFailed');
    courseGet
      .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: course }) })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { ...course, status: 'published' },
        }),
      });

    await expect(callAs().publishCourse(input)).resolves.toMatchObject({
      status: 'published',
    });
  });

  it('reports CONFLICT when the course changed some other way in between', async () => {
    canceledWith('ConditionalCheckFailed');
    courseGet
      .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: course }) })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { ...course, status: 'archived' },
        }),
      });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it.each([
    ['module', 1],
    ['lesson', 2],
    ['content item', 3],
  ])(
    'does not publish when the guarded %s changed after the check',
    async (_, index) => {
      canceledWith(
        ...[0, 1, 2, 3].map((i) =>
          i === index ? 'ConditionalCheckFailed' : undefined,
        ),
      );

      await expect(callAs().publishCourse(input)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: "The course's content changed while publishing; please retry",
      });
      expect(courseInstructorPatch).not.toHaveBeenCalled();
    },
  );

  // DynamoDB cancels one of two transactions that touch the same records at
  // once with TransactionConflict rather than a failed condition. Nothing was
  // written, so it's a retryable conflict, not a server error.
  it.each([
    [['TransactionConflict', undefined, undefined, undefined]],
    [[undefined, undefined, undefined, 'TransactionConflict']],
    [['TransactionConflict', undefined, undefined, 'TransactionConflict']],
  ])(
    'reports CONFLICT, not a server error, for a transaction conflict %j',
    async (codes) => {
      canceledWith(...codes);

      await expect(callAs().publishCourse(input)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
      expect(courseInstructorPatch).not.toHaveBeenCalled();
    },
  );

  it('reports INTERNAL_SERVER_ERROR when the transaction is canceled for another reason', async () => {
    canceledWith(undefined, undefined, undefined, undefined);

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('reports INTERNAL_SERVER_ERROR when the cancellation carries no per-item results', async () => {
    transactionGo.mockResolvedValue({ canceled: true });

    await expect(callAs().publishCourse(input)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(courseInstructorPatch).not.toHaveBeenCalled();
  });

  it('does not swallow other write failures', async () => {
    transactionGo.mockRejectedValue(new Error('DynamoDB is unavailable'));

    await expect(callAs().publishCourse(input)).rejects.toThrow();
  });

  it('refreshes the denormalized courseUpdatedAt on every instructor', async () => {
    givenPublishCommits({ updatedAt: '2024-03-01T00:00:00.000Z' });
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
          { courseId: course.courseId, instructorId: 'co-instructor' },
        ],
      }),
    });

    await callAs().publishCourse(input);

    expect(courseInstructorPatchSet).toHaveBeenCalledTimes(2);
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: '2024-03-01T00:00:00.000Z',
    });
  });
});

describe('restoreCourse', () => {
  const input = { courseId: course.courseId };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).restoreCourse(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().restoreCourse(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('restores a course that was published before it was archived to published', async () => {
    givenCourse({
      status: 'archived',
      publishedAt: '2024-02-01T00:00:00.000Z',
    });

    await callAs().restoreCourse(input);

    expect(coursePatchSet).toHaveBeenCalledWith({ status: 'published' });
    expect(conditionOf()).toBe('status = archived');
  });

  // Invariant: a course that has been open to students never returns to
  // draft, where deletes are permanent.
  it('restores a course that was never published to draft', async () => {
    givenCourse({ status: 'archived' });

    await callAs().restoreCourse(input);

    expect(coursePatchSet).toHaveBeenCalledWith({ status: 'draft' });
  });

  it.each(['draft', 'published'])(
    'writes nothing when the course is %s',
    async (status) => {
      givenCourse({ status });

      await expect(callAs().restoreCourse(input)).resolves.toMatchObject({
        status,
      });
      expect(coursePatch).not.toHaveBeenCalled();
    },
  );

  it('succeeds when another request restored it between the read and the write', async () => {
    givenCourse({
      status: 'archived',
      publishedAt: '2024-02-01T00:00:00.000Z',
    });
    coursePatchGo.mockRejectedValue(conditionalCheckFailed());
    courseGet
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { ...course, status: 'archived', publishedAt: 'x' },
        }),
      })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { ...course, status: 'published', publishedAt: 'x' },
        }),
      });

    await expect(callAs().restoreCourse(input)).resolves.toMatchObject({
      status: 'published',
    });
  });

  it('does not swallow other write failures', async () => {
    givenCourse({ status: 'archived' });
    coursePatchGo.mockRejectedValue(new Error('DynamoDB is unavailable'));

    await expect(callAs().restoreCourse(input)).rejects.toThrow(
      'DynamoDB is unavailable',
    );
    expect(courseInstructorPatch).not.toHaveBeenCalled();
  });

  it('reports CONFLICT when the course is still archived but the write failed its condition', async () => {
    givenCourse({ status: 'archived' });
    coursePatchGo.mockRejectedValue(conditionalCheckFailed());

    await expect(callAs().restoreCourse(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refreshes the denormalized courseUpdatedAt on every instructor', async () => {
    givenCourse({ status: 'archived' });
    coursePatchGo.mockResolvedValue({
      data: {
        ...course,
        status: 'draft',
        updatedAt: '2024-03-01T00:00:00.000Z',
      },
    });
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ courseId: course.courseId, instructorId: INSTRUCTOR_SUB }],
      }),
    });

    await callAs().restoreCourse(input);

    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: '2024-03-01T00:00:00.000Z',
    });
  });
});

describe('viewCourse', () => {
  const timestamps = {
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
  const module = {
    moduleId: 'module-1',
    courseId: course.courseId,
    title: 'Introduction',
    order: 1,
    visibility: 'hidden' as const,
    ...timestamps,
  };
  const lesson = {
    lessonId: 'lesson-1',
    moduleId: 'module-1',
    courseId: course.courseId,
    title: 'Welcome',
    order: 1,
    visibility: 'visible' as const,
    archivedAt: '2024-02-01T00:00:00.000Z',
    ...timestamps,
  };
  const contentItem = (contentItemId: string, order: number) => ({
    contentItemId,
    lessonId: 'lesson-1',
    moduleId: 'module-1',
    courseId: course.courseId,
    type: 'text' as const,
    status: 'ready' as const,
    title: contentItemId,
    body: '{}',
    order,
    visibility: 'hidden' as const,
    studentActivityCount: 2,
    ...timestamps,
  });

  it('returns when the course was first published, once it has been', async () => {
    const published = {
      ...course,
      status: 'published' as const,
      publishedAt: '2024-02-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [published], module: [], lesson: [], contentItem: [] },
      }),
    });

    const result = await callAs().viewCourse({ courseId: course.courseId });

    expect(result.publishedAt).toBe('2024-02-01T00:00:00.000Z');
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().viewCourse({ courseId: course.courseId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(curriculumCollection).not.toHaveBeenCalled();
  });

  // The course editor needs everything, including what students can't see,
  // along with the state that decides it.
  it('returns the whole curriculum, including hidden and archived records, sorted by order', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
      }),
    });
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [module],
          lesson: [lesson],
          contentItem: [contentItem('item-2', 2), contentItem('item-1', 1)],
        },
      }),
    });

    const result = await callAs().viewCourse({ courseId: course.courseId });

    // Every page, not just the first: a curriculum can exceed 1 MB.
    expect(curriculumCollection.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
    expect(result).toEqual({
      ...course,
      modules: [
        {
          ...module,
          lessons: [
            {
              ...lesson,
              contentItems: [
                contentItem('item-1', 1),
                contentItem('item-2', 2),
              ],
            },
          ],
        },
      ],
    });
  });

  // Each lesson goes under its own module and each item under its own
  // lesson, all sorted by order, however the query returns them.
  it('groups lessons under their module and items under their lesson, sorted by order', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
      }),
    });
    const moduleA = { ...module, moduleId: 'module-a', order: 2 };
    const moduleB = { ...module, moduleId: 'module-b', order: 1 };
    const lessonIn = (moduleId: string, lessonId: string, order: number) => ({
      ...lesson,
      archivedAt: undefined,
      moduleId,
      lessonId,
      order,
    });
    const itemIn = (
      moduleId: string,
      lessonId: string,
      contentItemId: string,
      order: number,
    ) => ({ ...contentItem(contentItemId, order), moduleId, lessonId });
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [moduleA, moduleB],
          lesson: [
            lessonIn('module-a', 'a2', 2),
            lessonIn('module-b', 'b1', 1),
            lessonIn('module-a', 'a1', 1),
          ],
          contentItem: [
            itemIn('module-a', 'a1', 'a1-item-2', 2),
            itemIn('module-b', 'b1', 'b1-item-1', 1),
            itemIn('module-a', 'a1', 'a1-item-1', 1),
          ],
        },
      }),
    });

    const result = await callAs().viewCourse({ courseId: course.courseId });

    expect(
      result.modules.map((m) => ({
        moduleId: m.moduleId,
        lessons: m.lessons.map((l) => ({
          lessonId: l.lessonId,
          items: l.contentItems.map((i) => i.contentItemId),
        })),
      })),
    ).toEqual([
      {
        moduleId: 'module-b',
        lessons: [{ lessonId: 'b1', items: ['b1-item-1'] }],
      },
      {
        moduleId: 'module-a',
        lessons: [
          { lessonId: 'a1', items: ['a1-item-1', 'a1-item-2'] },
          { lessonId: 'a2', items: [] },
        ],
      },
    ]);
  });

  it('throws NOT_FOUND when the course does not exist', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { courseId: 'missing', instructorId: INSTRUCTOR_SUB },
      }),
    });
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [], module: [], lesson: [], contentItem: [] },
      }),
    });

    await expect(
      callAs().viewCourse({ courseId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
