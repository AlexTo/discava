/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  ARCHIVED_AT,
  ancestorCheck,
  courseCheck,
  courseGet,
  courseInstructorGet,
  courseInstructorPatch,
  INSTRUCTOR_SUB,
  installDefaults,
  lesson,
  lessonGet,
  lessonKey,
  module,
  moduleGet,
  moduleKey,
  NOT_ARCHIVED,
  resolves,
  setCourseStatus,
  transactionGo,
  transactionWrites,
} from './curriculum-lifecycle.fixtures.js';
import {
  createLesson,
  hideLesson,
  publishLesson,
  restoreLesson,
  setLessonFreePreview,
  updateLesson,
} from './lesson.js';

const {
  mockModule,
  bestEffortDeleteContentItemVideos,
  bestEffortCancelTranscodeJobs,
} = await vi.hoisted(
  async () => (await import('./curriculum-lifecycle.fixtures.js')).spies,
);

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);
vi.mock('../helpers/s3-client.js', () => ({
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions: vi.fn(async () => {}),
}));
vi.mock('../helpers/mediaconvert-client.js', () => ({
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({
  setLessonFreePreview,
  createLesson,
  updateLesson,
  publishLesson,
  hideLesson,
  restoreLesson,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

const marked = { ...lesson, freePreview: true };

beforeEach(installDefaults);

describe('setLessonFreePreview', () => {
  it('marks the lesson with freePreview true, conditioned on an ordinary, unarchived lesson', async () => {
    lessonGet
      .mockReturnValueOnce(resolves(lesson))
      .mockReturnValue(resolves(marked));

    const result = await callAs().setLessonFreePreview({
      ...lessonKey,
      freePreview: true,
    });

    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      {
        entity: 'lesson',
        op: 'patch',
        key: lessonKey,
        set: { freePreview: true },
        condition: `${NOT_ARCHIVED} AND kind = lesson`,
      },
    ]);
    expect(result.freePreview).toBe(true);
  });

  it('unmarks by removing the attribute, never writing false', async () => {
    lessonGet
      .mockReturnValueOnce(resolves(marked))
      .mockReturnValue(resolves(lesson));

    const result = await callAs().setLessonFreePreview({
      ...lessonKey,
      freePreview: false,
    });

    expect(transactionWrites[2]).toEqual({
      entity: 'lesson',
      op: 'patch',
      key: lessonKey,
      remove: ['freePreview'],
      condition: NOT_ARCHIVED,
    });
    expect(JSON.stringify(transactionWrites)).not.toContain('false');
    expect(result.freePreview).toBe(false);
  });

  it.each([
    ['marking a marked lesson', marked, true],
    ['unmarking an unmarked lesson', lesson, false],
  ])('writes nothing when %s', async (_name, existing, freePreview) => {
    lessonGet.mockReturnValue(resolves(existing));

    const result = await callAs().setLessonFreePreview({
      ...lessonKey,
      freePreview,
    });

    expect(transactionGo).not.toHaveBeenCalled();
    expect(result.freePreview).toBe(freePreview);
  });

  it('refuses to mark an assignment lesson and writes nothing', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, kind: 'assignment' }));

    await expect(
      callAs().setLessonFreePreview({ ...lessonKey, freePreview: true }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: "Assignment lessons can't be free previews",
    });
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('returns an assignment lesson unchanged when unmarking it', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, kind: 'assignment' }));

    const result = await callAs().setLessonFreePreview({
      ...lessonKey,
      freePreview: false,
    });

    expect(result.freePreview).toBe(false);
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('refuses an archived lesson', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

    await expect(
      callAs().setLessonFreePreview({ ...lessonKey, freePreview: true }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson before changing its free preview',
    });
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('refuses an archived module', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    await expect(
      callAs().setLessonFreePreview({ ...lessonKey, freePreview: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('refuses an archived course', async () => {
    setCourseStatus('archived');

    await expect(
      callAs().setLessonFreePreview({ ...lessonKey, freePreview: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('reports the lesson as archived when it is archived between the read and the write', async () => {
    lessonGet
      .mockReturnValueOnce(resolves(lesson))
      .mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    // The course and module checks pass, the lesson's condition fails.
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [
        { code: 'None' },
        { code: 'None' },
        { code: 'ConditionalCheckFailed' },
      ],
    });

    await expect(
      callAs().setLessonFreePreview({ ...lessonKey, freePreview: true }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson before changing its free preview',
    });
  });

  it('refuses a caller who is not in the instructor group', async () => {
    await expect(
      callAs(['student']).setLessonFreePreview({
        ...lessonKey,
        freePreview: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('refuses an instructor who does not teach the course', async () => {
    courseInstructorGet.mockReturnValue(resolves(undefined));

    await expect(
      callAs().setLessonFreePreview({ ...lessonKey, freePreview: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(lessonGet).not.toHaveBeenCalled();
    expect(transactionGo).not.toHaveBeenCalled();
  });

  it('marks a hidden lesson in a draft course, independent of visibility', async () => {
    setCourseStatus('draft');
    lessonGet
      .mockReturnValueOnce(resolves({ ...lesson, visibility: 'hidden' }))
      .mockReturnValue(resolves({ ...marked, visibility: 'hidden' }));

    const result = await callAs().setLessonFreePreview({
      ...lessonKey,
      freePreview: true,
    });

    expect(result).toMatchObject({ freePreview: true, visibility: 'hidden' });
    expect(transactionWrites[2]).toMatchObject({ set: { freePreview: true } });
  });

  it('does not write the course or any instructor record', async () => {
    courseGet.mockReturnValue(
      resolves({ courseId: lesson.courseId, status: 'published' }),
    );
    lessonGet
      .mockReturnValueOnce(resolves(lesson))
      .mockReturnValue(resolves(marked));

    await callAs().setLessonFreePreview({ ...lessonKey, freePreview: true });

    expect(
      transactionWrites.map(({ entity, op }) => `${entity} ${op}`),
    ).toEqual(['course check', 'module check', 'lesson patch']);
    expect(courseInstructorPatch).not.toHaveBeenCalled();
  });
});

describe('lessons returned by the other procedures', () => {
  it('report an unmarked lesson as freePreview false', async () => {
    const result = await callAs().updateLesson({
      ...lessonKey,
      title: 'New title',
    });
    expect(result.freePreview).toBe(false);
  });

  it.each([
    ['updateLesson', { ...lessonKey, title: 'New title' }, marked],
    ['publishLesson', lessonKey, { ...marked, visibility: 'hidden' as const }],
    ['hideLesson', lessonKey, marked],
    ['restoreLesson', lessonKey, { ...marked, archivedAt: ARCHIVED_AT }],
  ] as const)(
    '%s returns the mark and does not change it',
    async (procedure, input, existing) => {
      lessonGet.mockReturnValue(resolves(existing));

      const result = await (callAs() as any)[procedure](input);

      expect(result.freePreview).toBe(true);
      for (const write of transactionWrites) {
        expect(write.set ?? {}).not.toHaveProperty('freePreview');
        expect(write.remove ?? []).not.toContain('freePreview');
      }
    },
  );

  it('createLesson returns the new lesson unmarked and writes no mark', async () => {
    const result = await callAs().createLesson({
      ...moduleKey,
      title: 'New lesson',
    });

    expect(result.freePreview).toBe(false);
  });
});
