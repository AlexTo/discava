/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  checkConditions,
  conditionOf,
  conditionText,
  contentItemCheck,
  course,
  courseInstructorPatchSet,
  coursePatchGo,
  coursePatchRemove,
  coursePatchSet,
  coursePatchWhere,
  givenCourse,
  givenPublishCommits,
  INSTRUCTOR_SUB,
  installDefaults,
  lessonCheck,
  moduleCheck,
  transactionGo,
  visibleCurriculum,
} from './course.fixtures.js';
import { publishCourse, setCoursePrice } from './course.js';

const {
  courseCreate,
  courseGet,
  courseInstructorCreate,
  courseInstructorGet,
  courseInstructorPatch,
  courseInstructorQueryPrimary,
  coursePatch,
  coursePreviewGet,
  curriculumCollection,
  ensureProfile,
  paymentConnectionGet,
  transactionWrite,
} = await vi.hoisted(async () => (await import('./course.fixtures.js')).spies);

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  ensureInstructorProfile: ensureProfile,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: {
        create: courseCreate,
        get: courseGet,
        patch: coursePatch,
      },
      coursePreview: { get: coursePreviewGet },
      paymentConnection: { get: paymentConnectionGet },
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
  publishCourse,
  setCoursePrice,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

beforeEach(installDefaults);

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

describe('setCoursePrice', () => {
  const input = {
    courseId: course.courseId,
    priceAmount: 1999,
    priceCurrency: 'EUR',
  };
  const readCourse = (priceAmount: number, pricedAt?: string) =>
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...course, priceAmount, ...(pricedAt && { pricedAt }) },
      }),
    });
  // The condition the patch was given, run against a recording stub.
  const patchCondition = () => {
    const eq = vi.fn(() => 'eq');
    const where = coursePatchWhere.mock.calls.at(-1)?.[0] as (
      attr: Record<string, string>,
      op: { eq: typeof eq },
    ) => string;
    where({ priceAmount: 'priceAmount' }, { eq });
    return eq.mock.calls[0];
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).setCoursePrice(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });
    await expect(callAs().setCoursePrice(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('sets a price, with pricedAt, on a free course', async () => {
    readCourse(0);
    coursePatchGo.mockResolvedValueOnce({
      data: { ...course, priceAmount: 1999, priceCurrency: 'EUR' },
    });

    const result = await callAs().setCoursePrice(input);

    expect(coursePatchSet).toHaveBeenCalledWith({
      priceAmount: 1999,
      priceCurrency: 'EUR',
      pricedAt: expect.any(String),
    });
    expect(coursePatchRemove).not.toHaveBeenCalled();
    expect(patchCondition()).toEqual(['priceAmount', 0]);
    expect(result).toMatchObject({ priceAmount: 1999, priceCurrency: 'EUR' });
  });

  it('keeps pricedAt when one price changes to another', async () => {
    readCourse(500, '2024-02-01T00:00:00.000Z');
    await callAs().setCoursePrice(input);

    expect(coursePatchSet).toHaveBeenCalledWith({
      priceAmount: 1999,
      priceCurrency: 'EUR',
    });
    expect(coursePatchRemove).not.toHaveBeenCalled();
    expect(patchCondition()).toEqual(['priceAmount', 500]);
  });

  it('clears the price and removes pricedAt', async () => {
    readCourse(500, '2024-02-01T00:00:00.000Z');
    await callAs().setCoursePrice({ ...input, priceAmount: 0 });

    expect(coursePatchSet).toHaveBeenCalledWith({
      priceAmount: 0,
      priceCurrency: 'EUR',
    });
    expect(coursePatchRemove).toHaveBeenCalledWith(['pricedAt']);
  });

  it.each([
    ['a non-integer', { priceAmount: 10.5 }],
    ['99', { priceAmount: 99 }],
    ['1,000,001', { priceAmount: 1_000_001 }],
    ['a negative amount', { priceAmount: -100 }],
    ['an unsupported currency', { priceCurrency: 'JPY' }],
  ])('refuses %s and writes nothing', async (_name, change) => {
    await expect(
      callAs().setCoursePrice({ ...input, ...change }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['changing', { status: 'changing' }],
    ['disconnected', { status: 'disconnected' }],
  ])(
    'refuses a non-zero price when the connection is %s',
    async (_name, record) => {
      paymentConnectionGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: record }),
      });

      await expect(callAs().setCoursePrice(input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: "Payments aren't set up yet; ask an administrator",
      });
      expect(coursePatch).not.toHaveBeenCalled();
    },
  );

  it('still sets a course to free when payments are not connected', async () => {
    paymentConnectionGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });
    readCourse(500, '2024-02-01T00:00:00.000Z');

    await callAs().setCoursePrice({ ...input, priceAmount: 0 });

    expect(paymentConnectionGet).not.toHaveBeenCalled();
    expect(coursePatchRemove).toHaveBeenCalledWith(['pricedAt']);
  });

  it.each(['draft', 'published', 'archived'] as const)(
    'prices a %s course',
    async (status) => {
      coursePatchGo.mockResolvedValueOnce({
        data: { ...course, status, priceAmount: 1999 },
      });
      const result = await callAs().setCoursePrice(input);
      expect(result.status).toBe(status);
    },
  );

  it("moves updatedAt and every instructor's courseUpdatedAt", async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: {
        ...course,
        priceAmount: 1999,
        updatedAt: '2024-03-01T00:00:00.000Z',
      },
    });
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
          { courseId: course.courseId, instructorId: 'co-instructor' },
        ],
      }),
    });

    const result = await callAs().setCoursePrice(input);

    expect(result.updatedAt).toBe('2024-03-01T00:00:00.000Z');
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: 'co-instructor',
    });
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: '2024-03-01T00:00:00.000Z',
    });
  });

  it('retries once from the new state when the amount moved, then gives up with CONFLICT', async () => {
    const failed = Object.assign(new Error('conditional'), {
      cause: Object.assign(new Error('conditional'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
    coursePatchGo.mockRejectedValueOnce(failed);
    coursePatchGo.mockResolvedValueOnce({
      data: { ...course, priceAmount: 1999 },
    });
    await expect(callAs().setCoursePrice(input)).resolves.toMatchObject({
      priceAmount: 1999,
    });
    expect(coursePatchGo).toHaveBeenCalledTimes(2);

    coursePatchGo.mockReset();
    coursePatchGo.mockRejectedValue(failed);
    await expect(callAs().setCoursePrice(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('never touches orders or enrolments', async () => {
    await callAs().setCoursePrice(input);
    // The entity mock has neither entity, so a touch would throw.
    expect(coursePatch).toHaveBeenCalledTimes(1);
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});
