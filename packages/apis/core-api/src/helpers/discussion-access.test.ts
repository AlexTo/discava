/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireDiscussionAccess } from './discussion-access.js';

const ref = { courseId: 'c1', moduleId: 'm1', lessonId: 'l1' };

type Records = {
  course: unknown;
  module: unknown;
  lesson: unknown;
  enrolment: unknown;
  instructor: unknown;
};

const shown = { visibility: 'visible' };
let records: Records;
const instructorGet = vi.fn();

const resolves = (read: () => unknown) => ({
  go: async () => ({ data: read() }),
});

const coreTable = {
  entities: {
    course: { get: () => resolves(() => records.course) },
    module: { get: () => resolves(() => records.module) },
    lesson: {
      get: ({ moduleId }: { moduleId: string }) =>
        resolves(() => (moduleId === 'm1' ? records.lesson : null)),
    },
    enrolment: { get: () => resolves(() => records.enrolment) },
    courseInstructor: {
      get: (key: unknown) => {
        instructorGet(key);
        return resolves(() => records.instructor);
      },
    },
  },
} as any;

const student = { sub: 'u1', groups: ['student'] };
const instructor = { sub: 'u1', groups: ['instructor'] };
const run = (user = student, options?: { lessonMustBeShown?: boolean }) =>
  requireDiscussionAccess(coreTable, user, ref, options);

beforeEach(() => {
  instructorGet.mockReset();
  records = {
    course: { courseId: 'c1', status: 'published' },
    module: shown,
    lesson: shown,
    enrolment: { status: 'active' },
    instructor: null,
  };
});

describe('requireDiscussionAccess', () => {
  it('lets an enrolled student into a shown lesson', async () => {
    const access = await run();
    expect(access.isInstructor).toBe(false);
    expect(access.lesson).toBe(shown);
    expect(instructorGet).not.toHaveBeenCalled();
  });

  it('refuses a missing course as not found', async () => {
    records.course = null;
    await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a student who is not enrolled in a published course', async () => {
    records.enrolment = null;
    await expect(run()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Enrol in the course to view it',
    });
  });

  it('refuses a dropped student', async () => {
    records.enrolment = { status: 'dropped' };
    await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('hides a draft or archived course from a student who is not enrolled', async () => {
    records.enrolment = null;
    for (const status of ['draft', 'archived']) {
      records.course = { courseId: 'c1', status };
      await expect(run()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('keeps an archived course open to an enrolled student', async () => {
    records.course = { courseId: 'c1', status: 'archived' };
    await expect(run()).resolves.toMatchObject({ isInstructor: false });
  });

  it.each([
    ['hidden module', { module: { visibility: 'hidden' } }],
    [
      'archived module',
      { module: { visibility: 'visible', archivedAt: 'then' } },
    ],
    ['hidden lesson', { lesson: { visibility: 'hidden' } }],
    [
      'archived lesson',
      { lesson: { visibility: 'visible', archivedAt: 'then' } },
    ],
    ['missing lesson', { lesson: null }],
  ])('refuses a student for a %s', async (_name, change) => {
    Object.assign(records, change);
    await expect(run()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This lesson is not available',
    });
  });

  it('refuses a moduleId that does not hold the lesson', async () => {
    await expect(
      requireDiscussionAccess(coreTable, student, {
        ...ref,
        moduleId: 'other',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an instructor of the course into any existing lesson, enrolled or not', async () => {
    records.enrolment = null;
    records.instructor = { instructorId: 'u1' };
    records.course = { courseId: 'c1', status: 'archived' };
    records.lesson = { visibility: 'hidden', archivedAt: 'then' };
    const access = await run(instructor);
    expect(access.isInstructor).toBe(true);
    expect(instructorGet).toHaveBeenCalledWith({
      courseId: 'c1',
      instructorId: 'u1',
    });
  });

  it('still needs the lesson to exist for an instructor', async () => {
    records.instructor = { instructorId: 'u1' };
    records.lesson = null;
    await expect(run(instructor)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('treats an instructor of another course as a student', async () => {
    // No courseInstructor record for this course.
    records.enrolment = null;
    await expect(run(instructor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('treats an instructor-group user with no record as a student, enrolled or not', async () => {
    await expect(run(instructor)).resolves.toMatchObject({
      isInstructor: false,
    });
  });

  it('does not make an admin an instructor of a course that does not list them', async () => {
    records.enrolment = null;
    await expect(run({ sub: 'u1', groups: ['admin'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(instructorGet).not.toHaveBeenCalled();
  });

  it('does not look for an instructor record without the instructor group', async () => {
    records.instructor = { instructorId: 'u1' };
    await expect(run()).resolves.toMatchObject({ isInstructor: false });
  });

  it('lets a student reach a hidden lesson when it need not be shown', async () => {
    records.lesson = { visibility: 'hidden' };
    await expect(
      run(student, { lessonMustBeShown: false }),
    ).resolves.toMatchObject({ isInstructor: false });
  });

  it('still needs enrolment when the lesson need not be shown', async () => {
    records.enrolment = null;
    await expect(
      run(student, { lessonMustBeShown: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
