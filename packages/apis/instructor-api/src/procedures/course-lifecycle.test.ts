/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { DEFAULT_FIRST_LESSON_PROMPT } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  conditionalCheckFailed,
  conditionOf,
  course,
  courseInstructorPatchSet,
  coursePatchGo,
  coursePatchSet,
  coursePatchWhere,
  givenCourse,
  INSTRUCTOR_SUB,
  installDefaults,
  transactionGo,
} from './course.fixtures.js';
import {
  archiveCourse,
  createCourse,
  restoreCourse,
  setCourseCertificateCriteria,
  setCourseCertificates,
  setCourseFirstLessonPrompt,
  viewCourse,
} from './course.js';

const {
  courseCreate,
  courseGet,
  courseInstructorCreate,
  courseInstructorGet,
  courseInstructorPatch,
  courseInstructorQueryPrimary,
  coursePatch,
  coursePatchRemove,
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
  createCourse,
  archiveCourse,
  restoreCourse,
  setCourseCertificates,
  setCourseCertificateCriteria,
  setCourseFirstLessonPrompt,
  viewCourse,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

beforeEach(installDefaults);

describe('createCourse', () => {
  it("ensures the caller's profile before the course transaction", async () => {
    const order: string[] = [];
    ensureProfile.mockImplementation(async () => {
      order.push('profile');
      return { status: 'created', handle: 'instructor-one' };
    });
    transactionGo.mockImplementation(async () => {
      order.push('course');
      return { canceled: false, data: [] };
    });

    await callAs().createCourse({ title: 'Intro' });

    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(ensureProfile).toHaveBeenCalledWith(
      expect.anything(),
      INSTRUCTOR_SUB,
    );
    expect(order).toEqual(['profile', 'course']);
  });

  it('ensures the profile on every course, leaving the first-time rule to the helper', async () => {
    await callAs().createCourse({ title: 'One' });
    await callAs().createCourse({ title: 'Two' });

    expect(ensureProfile).toHaveBeenCalledTimes(2);
  });

  it('creates no course when the profile cannot be ensured', async () => {
    ensureProfile.mockRejectedValue(new Error('boom'));

    await expect(callAs().createCourse({ title: 'Intro' })).rejects.toThrow();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

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

  it('creates a course free, in USD, with no pricedAt', async () => {
    await callAs().createCourse({ title: 'Intro to DynamoDB' });
    expect(courseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ priceAmount: 0, priceCurrency: 'USD' }),
    );
    expect(courseCreate.mock.calls[0]?.[0]).not.toHaveProperty('pricedAt');
  });

  it('stores certificatesEnabled: true on a new course', async () => {
    await callAs().createCourse({ title: 'Intro to DynamoDB' });
    expect(courseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ certificatesEnabled: true }),
    );
  });

  it('stores the default certificate criteria on a new course', async () => {
    await callAs().createCourse({ title: 'Intro to DynamoDB' });
    expect(courseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        certificateCriteria: { version: 1, requireQuizPass: false },
      }),
    );
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

describe('setCourseCertificates', () => {
  const input = { courseId: course.courseId, enabled: false };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).setCourseCertificates(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().setCourseCertificates(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('turns certificates off and on, returning the course with the setting', async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: { ...course, certificatesEnabled: false },
    });
    const off = await callAs().setCourseCertificates(input);
    expect(coursePatch).toHaveBeenCalledWith({ courseId: course.courseId });
    expect(coursePatchSet).toHaveBeenCalledWith({ certificatesEnabled: false });
    expect(off.certificatesEnabled).toBe(false);

    coursePatchGo.mockResolvedValueOnce({ data: course });
    const on = await callAs().setCourseCertificates({
      ...input,
      enabled: true,
    });
    expect(coursePatchSet).toHaveBeenLastCalledWith({
      certificatesEnabled: true,
    });
    expect(on.certificatesEnabled).toBe(true);
  });

  it.each(['draft', 'published', 'archived'] as const)(
    'changes the setting of a %s course',
    async (status) => {
      coursePatchGo.mockResolvedValueOnce({
        data: { ...course, status, certificatesEnabled: false },
      });

      const result = await callAs().setCourseCertificates(input);

      expect(result.status).toBe(status);
      expect(coursePatchWhere).not.toHaveBeenCalled();
    },
  );

  it("moves updatedAt and every instructor's courseUpdatedAt", async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: {
        ...course,
        certificatesEnabled: false,
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

    const result = await callAs().setCourseCertificates(input);

    expect(result.updatedAt).toBe('2024-03-01T00:00:00.000Z');
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: INSTRUCTOR_SUB,
    });
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: 'co-instructor',
    });
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: '2024-03-01T00:00:00.000Z',
    });
  });

  it('never reads or writes existing certificates', async () => {
    await callAs().setCourseCertificates(input);

    // The entity mock above has no `certificate` entity, so a touch would
    // throw; the course patch is the only write to the course table.
    expect(coursePatch).toHaveBeenCalledTimes(1);
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('setCourseFirstLessonPrompt', () => {
  const input = { courseId: course.courseId, prompt: 'What will you build?' };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).setCourseFirstLessonPrompt(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().setCourseFirstLessonPrompt(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('sets the trimmed text and returns the course', async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: { ...course, firstLessonPrompt: 'What will you build?' },
    });

    const result = await callAs().setCourseFirstLessonPrompt({
      ...input,
      prompt: '  What will you build?\n ',
    });

    expect(coursePatch).toHaveBeenCalledWith({ courseId: course.courseId });
    expect(coursePatchSet).toHaveBeenCalledWith({
      firstLessonPrompt: 'What will you build?',
    });
    expect(result.firstLessonPrompt).toBe('What will you build?');
  });

  it('accepts exactly 200 characters', async () => {
    const prompt = 'a'.repeat(200);

    await callAs().setCourseFirstLessonPrompt({ ...input, prompt });

    expect(coursePatchSet).toHaveBeenCalledWith({ firstLessonPrompt: prompt });
  });

  it('refuses more than 200 characters after trimming, writing nothing', async () => {
    await expect(
      callAs().setCourseFirstLessonPrompt({
        ...input,
        prompt: 'a'.repeat(201),
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The prompt must be at most 200 characters',
    });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('counts the text after trimming against the limit', async () => {
    await callAs().setCourseFirstLessonPrompt({
      ...input,
      prompt: ` ${'a'.repeat(200)} `,
    });

    expect(coursePatchSet).toHaveBeenCalledWith({
      firstLessonPrompt: 'a'.repeat(200),
    });
  });

  it.each([null, '', '  \n\t '])(
    "removes the course's own text for %j, so it uses the default",
    async (prompt) => {
      await callAs().setCourseFirstLessonPrompt({ ...input, prompt });

      expect(coursePatchRemove).toHaveBeenCalledWith(['firstLessonPrompt']);
      expect(coursePatchSet).not.toHaveBeenCalled();
    },
  );

  it.each(['draft', 'published', 'archived'] as const)(
    'changes the text of a %s course',
    async (status) => {
      coursePatchGo.mockResolvedValueOnce({
        data: { ...course, status, firstLessonPrompt: 'What will you build?' },
      });

      const result = await callAs().setCourseFirstLessonPrompt(input);

      expect(result.status).toBe(status);
      expect(coursePatchWhere).not.toHaveBeenCalled();
    },
  );

  it("moves updatedAt and every instructor's courseUpdatedAt", async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: { ...course, updatedAt: '2024-03-01T00:00:00.000Z' },
    });
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
          { courseId: course.courseId, instructorId: 'co-instructor' },
        ],
      }),
    });

    const result = await callAs().setCourseFirstLessonPrompt(input);

    expect(result.updatedAt).toBe('2024-03-01T00:00:00.000Z');
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: '2024-03-01T00:00:00.000Z',
    });
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: 'co-instructor',
    });
  });

  it('reads and writes no enrolment', async () => {
    await callAs().setCourseFirstLessonPrompt(input);

    // The entity mock has no `enrolment` entity, so a touch would throw.
    expect(coursePatch).toHaveBeenCalledTimes(1);
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('setCourseCertificateCriteria', () => {
  const input = { courseId: course.courseId, requireQuizPass: true };
  const required = { version: 2, requireQuizPass: true };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).setCourseCertificateCriteria(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().setCourseCertificateCriteria(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('stores the criteria with the next version and returns them', async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: { ...course, certificateCriteria: required },
    });

    const result = await callAs().setCourseCertificateCriteria(input);

    expect(coursePatchSet).toHaveBeenCalledWith({
      certificateCriteria: required,
    });
    expect(result.certificateCriteria).toEqual(required);
  });

  it('keeps the version and writes nothing when the values are unchanged', async () => {
    const result = await callAs().setCourseCertificateCriteria({
      ...input,
      requireQuizPass: false,
    });

    expect(result.certificateCriteria.version).toBe(1);
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it("moves updatedAt and every instructor's courseUpdatedAt", async () => {
    coursePatchGo.mockResolvedValueOnce({
      data: {
        ...course,
        certificateCriteria: required,
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

    const result = await callAs().setCourseCertificateCriteria(input);

    expect(result.updatedAt).toBe('2024-03-01T00:00:00.000Z');
    expect(courseInstructorPatch).toHaveBeenCalledWith({
      courseId: course.courseId,
      instructorId: 'co-instructor',
    });
    expect(courseInstructorPatchSet).toHaveBeenCalledWith({
      courseUpdatedAt: '2024-03-01T00:00:00.000Z',
    });
  });

  it('refuses minUploadScorePercent until graded uploads exist', async () => {
    await expect(
      callAs().setCourseCertificateCriteria({
        ...input,
        minUploadScorePercent: 70,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it.each(['draft', 'published', 'archived'] as const)(
    'changes the criteria of a %s course',
    async (status) => {
      givenCourse({ status });
      coursePatchGo.mockResolvedValueOnce({
        data: { ...course, status, certificateCriteria: required },
      });

      const result = await callAs().setCourseCertificateCriteria(input);

      expect(result.status).toBe(status);
      expect(coursePatchWhere).toHaveBeenCalledTimes(1);
    },
  );
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
    kind: 'lesson' as const,
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

  it('returns the default prompt, and no custom text when the course has none', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [course], module: [], lesson: [], contentItem: [] },
      }),
    });

    const result = await callAs().viewCourse({ courseId: course.courseId });

    expect(result.defaultFirstLessonPrompt).toBe(DEFAULT_FIRST_LESSON_PROMPT);
    expect(result.firstLessonPrompt).toBeUndefined();
  });

  it("returns the course's own prompt beside the default", async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [{ ...course, firstLessonPrompt: 'What will you build?' }],
          module: [],
          lesson: [],
          contentItem: [],
        },
      }),
    });

    const result = await callAs().viewCourse({ courseId: course.courseId });

    expect(result.firstLessonPrompt).toBe('What will you build?');
    expect(result.defaultFirstLessonPrompt).toBe(DEFAULT_FIRST_LESSON_PROMPT);
  });

  it('returns the preview as the editor needs it, without keys or uploader', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
      }),
    });
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [course], module: [], lesson: [], contentItem: [] },
      }),
    });
    coursePreviewGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          courseId: course.courseId,
          status: 'failed',
          failureReason: 'too-long',
          durationSeconds: 120,
          submissionNonce: 'nonce-2',
          previousS3Key: 'courses/course-1/preview/nonce-1/master.m3u8',
          uploadedBy: INSTRUCTOR_SUB,
        },
      }),
    });

    const result = await callAs().viewCourse({ courseId: course.courseId });

    expect(result.preview).toEqual({
      status: 'failed',
      failureReason: 'too-long',
      durationSeconds: 120,
      hasPlayableVersion: true,
      submissionNonce: 'nonce-2',
    });
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
      defaultFirstLessonPrompt: DEFAULT_FIRST_LESSON_PROMPT,
      modules: [
        {
          ...module,
          lessons: [
            {
              ...lesson,
              freePreview: false,
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
