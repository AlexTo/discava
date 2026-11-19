/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { deleteContentItemPermanently } from './content-item-shared.js';
import {
  ARCHIVED_AT,
  ancestorCheck,
  COURSE_ID,
  contentItemDelete,
  contentItemGet,
  contentItemQueryPrimary,
  courseCheck,
  discussionPostQueryPrimary,
  draftCourseCheck,
  INSTRUCTOR_SUB,
  installDefaults,
  itemKey,
  LESSON_ID,
  lesson,
  lessonGet,
  lessonKey,
  lessonQueryPrimary,
  module,
  moduleGet,
  moduleKey,
  NOT_ARCHIVED,
  renderCondition,
  resolves,
  resolvesPaged,
  setCourseStatus,
  textItem,
  transactionGo,
  transactionWrite,
  transactionWrites,
} from './curriculum-lifecycle.fixtures.js';
import {
  deleteLesson,
  deleteLessonPermanently,
  publishLesson,
} from './lesson.js';
import {
  deleteModule,
  deleteModulePermanently,
  publishModule,
} from './module.js';

// Covers what a course's status changes about curriculum edits (visibility of
// new records, delete vs. archive) and the publish/hide/restore/permanent
// delete lifecycle. The draft-course hard-delete cascades themselves are
// covered in module.test.ts, lesson.test.ts and content-item-shared.test.ts.

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
  deleteContentItemPermanently,
  deleteLesson,
  deleteLessonPermanently,
  publishLesson,
  deleteModule,
  deleteModulePermanently,
  publishModule,
});

const callAs = () =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups: ['instructor'] });

beforeEach(installDefaults);

describe('permanent delete', () => {
  // Invariant: only an archived record can be deleted permanently.
  it.each([
    ['deleteModulePermanently', moduleKey],
    ['deleteLessonPermanently', lessonKey],
    ['deleteContentItemPermanently', itemKey('item-1')],
  ] as const)(
    '%s refuses a record that is not archived',
    async (procedure, input) => {
      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
      expect(contentItemDelete).not.toHaveBeenCalled();
    },
  );

  // Invariant: student data is never destroyed by a curriculum edit -- a
  // record with any student activity under it can stay archived but can't
  // be deleted permanently.
  it('refuses to delete a module permanently when any content item in it has student activity', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-1'),
        textItem('item-2', { studentActivityCount: 3 }),
      ]),
    );

    await expect(
      callAs().deleteModulePermanently(moduleKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to delete a lesson permanently when any content item in it has student activity', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolves([textItem('item-1', { studentActivityCount: 1 })]),
    );

    await expect(
      callAs().deleteLessonPermanently(lessonKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // The checks and the delete are separate calls, so each content item
  // delete is conditioned on the updatedAt from the snapshot the activity
  // check looked at (a student's first activity in between bumps updatedAt),
  // and the parent's delete on the archivedAt that was checked (a restore in
  // between clears it). Either cancels the delete.
  it('deletes an archived module and everything under it, conditioned on the checked snapshot', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    lessonQueryPrimary.mockReturnValue(resolves([lesson]));
    contentItemQueryPrimary.mockReturnValue(
      resolves([textItem('item-1', { updatedAt: '2024-03-01T00:00:00.000Z' })]),
    );

    await callAs().deleteModulePermanently(moduleKey);

    expect(transactionWrites).toEqual([
      {
        entity: 'module',
        op: 'delete',
        key: moduleKey,
        condition: `archivedAt = ${ARCHIVED_AT}`,
      },
      { entity: 'lesson', op: 'delete', key: lessonKey },
      {
        entity: 'contentItem',
        op: 'delete',
        key: itemKey('item-1'),
        condition:
          'updatedAt = 2024-03-01T00:00:00.000Z AND studentActivityCount = 0',
      },
    ]);
  });

  it('deletes an archived lesson and its content items, conditioned on the checked snapshot', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolves([textItem('item-1', { updatedAt: '2024-03-01T00:00:00.000Z' })]),
    );

    await callAs().deleteLessonPermanently(lessonKey);

    expect(transactionWrites).toEqual([
      {
        entity: 'lesson',
        op: 'delete',
        key: lessonKey,
        condition: `archivedAt = ${ARCHIVED_AT}`,
      },
      {
        entity: 'contentItem',
        op: 'delete',
        key: itemKey('item-1'),
        condition:
          'updatedAt = 2024-03-01T00:00:00.000Z AND studentActivityCount = 0',
      },
    ]);
  });

  it('refuses to delete a content item permanently once a student has activity on it', async () => {
    contentItemGet.mockReturnValue(
      resolves(
        textItem('item-1', {
          archivedAt: ARCHIVED_AT,
          studentActivityCount: 1,
        }),
      ),
    );

    await expect(
      callAs().deleteContentItemPermanently(itemKey('item-1')),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(contentItemDelete).not.toHaveBeenCalled();
  });

  it('deletes an archived video content item, conditioned on no activity and still archived, then cleans up', async () => {
    const video = textItem('item-1', {
      type: 'video',
      status: 'ready',
      s3Key: 'key.mp4',
      mimeType: 'video/mp4',
      archivedAt: ARCHIVED_AT,
    });
    contentItemGet.mockReturnValue(resolves(video));
    const where = vi.fn((_condition: (attr: any, op: any) => string) => ({
      go: vi.fn().mockResolvedValue({ data: video }),
    }));
    contentItemDelete.mockReturnValue({ where });

    await callAs().deleteContentItemPermanently(itemKey('item-1'));

    expect(contentItemDelete).toHaveBeenCalledWith(itemKey('item-1'));
    expect(renderCondition(where.mock.calls[0][0])).toBe(
      'studentActivityCount = 0 AND exists(archivedAt)',
    );
    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [video],
    );
    expect(bestEffortDeleteContentItemVideos).toHaveBeenCalledWith(
      expect.anything(),
      [video],
    );
  });

  it('throws CONFLICT when the delete condition fails because the item changed after the checks', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
    );
    const conditionFailed = Object.assign(new Error('Conditional failed'), {
      cause: Object.assign(new Error('failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    });
    contentItemDelete.mockReturnValue({
      where: () => ({ go: vi.fn().mockRejectedValue(conditionFailed) }),
    });

    await expect(
      callAs().deleteContentItemPermanently(itemKey('item-1')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });
});

describe('descendants spanning more than one query page', () => {
  // Invariant: publish and permanent delete act on every descendant, not
  // just the first page of results.
  it('publishModule also publishes a hidden content item on a later page', async () => {
    moduleGet.mockReturnValue(resolves(module));
    contentItemQueryPrimary.mockReturnValue(
      resolvesPaged(
        [textItem('item-1')],
        [textItem('item-on-page-2', { visibility: 'hidden' })],
      ),
    );

    await callAs().publishModule(moduleKey);

    expect(transactionWrites).toEqual([
      {
        entity: 'module',
        op: 'check',
        key: moduleKey,
        condition: NOT_ARCHIVED,
      },
      // The item's lesson isn't being published, so it gets its own check.
      {
        entity: 'lesson',
        op: 'check',
        key: lessonKey,
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-on-page-2'),
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      courseCheck(),
    ]);
  });

  it('publishLesson also publishes a hidden content item on a later page', async () => {
    contentItemQueryPrimary.mockReturnValue(
      resolvesPaged(
        [textItem('item-1')],
        [textItem('item-on-page-2', { visibility: 'hidden' })],
      ),
    );

    await callAs().publishLesson(lessonKey);

    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      {
        entity: 'lesson',
        op: 'check',
        key: lessonKey,
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-on-page-2'),
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
    ]);
  });

  it('deleteModulePermanently refuses when the only item with student activity is on a later page', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolvesPaged(
        [textItem('item-1')],
        [textItem('item-on-page-2', { studentActivityCount: 1 })],
      ),
    );

    await expect(
      callAs().deleteModulePermanently(moduleKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('deleteLessonPermanently refuses when the only item with student activity is on a later page', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolvesPaged(
        [textItem('item-1')],
        [textItem('item-on-page-2', { studentActivityCount: 1 })],
      ),
    );

    await expect(
      callAs().deleteLessonPermanently(lessonKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // Invariant: questions are student data too. A lesson that was ever asked
  // about can stay archived but is never deleted permanently, and neither is
  // a module holding one.
  it('deleteLessonPermanently refuses a lesson that has questions', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    discussionPostQueryPrimary.mockReturnValue(
      resolves([{ lessonId: LESSON_ID }]),
    );

    await expect(
      callAs().deleteLessonPermanently(lessonKey),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message:
        'This lesson has questions, so it can stay archived but cannot be deleted permanently',
    });
    expect(discussionPostQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      kind: 'question',
      lessonId: LESSON_ID,
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('deleteModulePermanently refuses a module with a lesson that has questions', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    lessonQueryPrimary.mockReturnValue(
      resolves([lesson, { ...lesson, lessonId: 'lesson-2' }]),
    );
    discussionPostQueryPrimary.mockImplementation(
      ({ lessonId }: { lessonId: string }) =>
        resolves(lessonId === 'lesson-2' ? [{ lessonId }] : []),
    );

    await expect(
      callAs().deleteModulePermanently(moduleKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  // A draft course has never been open to students, so it has no questions
  // and deletes outright; once published, a delete archives instead and
  // never reaches the permanent path.
  it('deleteLesson in a published course archives the lesson and never deletes it', async () => {
    setCourseStatus('published');

    await callAs().deleteLesson(lessonKey);

    expect(transactionWrites.map(({ op }) => op)).not.toContain('delete');
    expect(transactionWrites).toContainEqual(
      expect.objectContaining({
        entity: 'lesson',
        op: 'patch',
        set: { archivedAt: expect.any(String) },
      }),
    );
  });

  it('a permanent delete removes descendants on every page', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolvesPaged([textItem('item-1')], [textItem('item-on-page-2')]),
    );

    await callAs().deleteLessonPermanently(lessonKey);

    expect(
      transactionWrites
        .filter(({ entity }) => entity === 'contentItem')
        .map(({ key }) => key?.contentItemId),
    ).toEqual(['item-1', 'item-on-page-2']);
  });
});

describe('DynamoDB 100-item transaction limit', () => {
  const hiddenItems = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      textItem(`item-${index}`, { visibility: 'hidden' }),
    );

  // Over the limit isn't a dead end: the refusal says what to do so the
  // operation fits, and it's reported as a precondition, not a server fault.
  it.each([
    [
      'publishModule',
      moduleKey,
      () =>
        moduleGet.mockReturnValue(
          resolves({ ...module, visibility: 'hidden' }),
        ),
      'Publish some of its lessons first, then the module.',
    ],
    [
      'publishLesson',
      lessonKey,
      () =>
        lessonGet.mockReturnValue(
          resolves({ ...lesson, visibility: 'hidden' }),
        ),
      'Publish some of its content items first, then the lesson.',
    ],
    [
      'deleteModulePermanently',
      moduleKey,
      () =>
        moduleGet.mockReturnValue(
          resolves({ ...module, archivedAt: ARCHIVED_AT }),
        ),
      'Delete some of its lessons first, then the module.',
    ],
    [
      'deleteLessonPermanently',
      lessonKey,
      () =>
        lessonGet.mockReturnValue(
          resolves({ ...lesson, archivedAt: ARCHIVED_AT }),
        ),
      'Delete some of its content items first, then the lesson.',
    ],
  ] as const)(
    '%s explains how to get under the limit',
    async (procedure, input, arrange, nextStep) => {
      arrange();
      contentItemQueryPrimary.mockReturnValue(resolves(hiddenItems(100)));

      const error = await (callAs() as any)
        [procedure](input)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(error.message).toContain('the limit is 100 records');
      expect(error.message).toContain(nextStep);
    },
  );

  // Invariant: an operation that must be atomic is refused outright rather
  // than split, so it never applies to only part of the module or lesson.
  it('publishModule refuses when more than 100 records would be published', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, visibility: 'hidden' }));
    contentItemQueryPrimary.mockReturnValue(resolves(hiddenItems(100)));

    await expect(callAs().publishModule(moduleKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('publishModule publishes exactly 100 records in one transaction', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, visibility: 'hidden' }));
    // The module, the course check, the lesson check and 97 items.
    contentItemQueryPrimary.mockReturnValue(resolves(hiddenItems(97)));

    await callAs().publishModule(moduleKey);

    expect(transactionWrites).toHaveLength(100);
  });

  it('publishLesson refuses when more than 100 records would be published', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, visibility: 'hidden' }));
    contentItemQueryPrimary.mockReturnValue(resolves(hiddenItems(100)));

    await expect(callAs().publishLesson(lessonKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('deleteModulePermanently refuses when the module and its descendants exceed 100 records', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(resolves(hiddenItems(100)));

    await expect(
      callAs().deleteModulePermanently(moduleKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('deleteLessonPermanently refuses when the lesson and its content items exceed 100 records', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(resolves(hiddenItems(100)));

    await expect(
      callAs().deleteLessonPermanently(lessonKey),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('lessons spanning more than one query page', () => {
  it('publishModule publishes a hidden lesson on a later page, and leaves items under an archived later-page lesson alone', async () => {
    lessonQueryPrimary.mockReturnValue(
      resolvesPaged(
        [lesson],
        [
          { ...lesson, lessonId: 'lesson-page-2', visibility: 'hidden' },
          {
            ...lesson,
            lessonId: 'lesson-archived-page-2',
            visibility: 'hidden',
            archivedAt: ARCHIVED_AT,
          },
        ],
      ),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-under-archived', {
          lessonId: 'lesson-archived-page-2',
          visibility: 'hidden',
        }),
      ]),
    );

    await callAs().publishModule(moduleKey);

    expect(transactionWrites).toEqual([
      {
        entity: 'module',
        op: 'check',
        key: moduleKey,
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'lesson',
        op: 'patch',
        key: { ...moduleKey, lessonId: 'lesson-page-2' },
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      courseCheck(),
    ]);
  });

  it('deleteModulePermanently deletes lessons on every page', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    lessonQueryPrimary.mockReturnValue(
      resolvesPaged([lesson], [{ ...lesson, lessonId: 'lesson-page-2' }]),
    );

    await callAs().deleteModulePermanently(moduleKey);

    expect(
      transactionWrites
        .filter(({ entity }) => entity === 'lesson')
        .map(({ key }) => key?.lessonId),
    ).toEqual([LESSON_ID, 'lesson-page-2']);
  });
});

describe('100-record boundary', () => {
  const items = (count: number, overrides: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, index) =>
      textItem(`item-${index}`, overrides),
    );

  // Exactly 100 records still fits in one transaction: the course and module
  // checks, the hidden lesson and 97 hidden items.
  it('publishLesson publishes a hidden lesson with 97 hidden items', async () => {
    lessonGet
      .mockReturnValueOnce(resolves({ ...lesson, visibility: 'hidden' }))
      .mockReturnValueOnce(resolves(lesson));
    contentItemQueryPrimary.mockReturnValue(
      resolves(items(97, { visibility: 'hidden' })),
    );

    await callAs().publishLesson(lessonKey);

    expect(transactionWrites).toHaveLength(100);
  });

  it('deleteLessonPermanently deletes a lesson with 99 items', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(resolves(items(99)));

    await callAs().deleteLessonPermanently(lessonKey);

    expect(transactionWrites).toHaveLength(100);
  });

  it('deleteModulePermanently deletes a module with 99 records under it', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    lessonQueryPrimary.mockReturnValue(resolves([lesson]));
    contentItemQueryPrimary.mockReturnValue(resolves(items(98)));

    await callAs().deleteModulePermanently(moduleKey);

    expect(transactionWrites).toHaveLength(100);
  });

  // A permanent delete in a draft course also carries the check that the
  // course is still a draft, so it fits one record fewer.
  it('deleteLesson in a draft course deletes a lesson with 98 items, plus the draft check', async () => {
    contentItemQueryPrimary.mockReturnValue(resolves(items(98)));

    await callAs().deleteLesson(lessonKey);

    expect(transactionWrites).toHaveLength(100);
    expect(transactionWrites.at(-1)).toEqual(
      draftCourseCheck(lessonKey.courseId),
    );
  });

  it('deleteLesson in a draft course refuses a lesson with 99 items, without a transaction', async () => {
    contentItemQueryPrimary.mockReturnValue(resolves(items(99)));

    await expect(callAs().deleteLesson(lessonKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('deleteModule in a draft course deletes a module with 98 records under it, plus the draft check', async () => {
    lessonQueryPrimary.mockReturnValue(resolves([lesson]));
    contentItemQueryPrimary.mockReturnValue(resolves(items(97)));

    await callAs().deleteModule(moduleKey);

    expect(transactionWrites).toHaveLength(100);
    expect(transactionWrites.at(-1)).toEqual(
      draftCourseCheck(moduleKey.courseId),
    );
  });

  it('deleteModule in a draft course refuses a module with 99 records under it, without a transaction', async () => {
    lessonQueryPrimary.mockReturnValue(resolves([lesson]));
    contentItemQueryPrimary.mockReturnValue(resolves(items(98)));

    await expect(callAs().deleteModule(moduleKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('student activity during a cascade permanent delete', () => {
  // Invariant: a cascade never deletes an item with student activity, even
  // when that activity was written in the same millisecond as the snapshot
  // (so updatedAt didn't change): every item delete also carries
  // studentActivityCount = 0, so DynamoDB itself refuses it.
  it.each([
    [
      'deleteModulePermanently',
      moduleKey,
      () =>
        moduleGet.mockReturnValue(
          resolves({ ...module, archivedAt: ARCHIVED_AT }),
        ),
    ],
    [
      'deleteLessonPermanently',
      lessonKey,
      () =>
        lessonGet.mockReturnValue(
          resolves({ ...lesson, archivedAt: ARCHIVED_AT }),
        ),
    ],
  ] as const)(
    '%s conditions every item delete on no student activity, not just on updatedAt',
    async (procedure, input, arrange) => {
      arrange();
      contentItemQueryPrimary.mockReturnValue(
        resolves([textItem('item-1'), textItem('item-2')]),
      );

      await (callAs() as any)[procedure](input);

      const itemConditions = transactionWrites
        .filter(({ entity }) => entity === 'contentItem')
        .map(({ condition }) => condition);
      expect(itemConditions).toHaveLength(2);
      for (const condition of itemConditions) {
        expect(condition).toContain('studentActivityCount = 0');
      }
    },
  );

  it.each([
    [
      'deleteModulePermanently',
      moduleKey,
      () =>
        moduleGet.mockReturnValue(
          resolves({ ...module, archivedAt: ARCHIVED_AT }),
        ),
    ],
    [
      'deleteLessonPermanently',
      lessonKey,
      () =>
        lessonGet.mockReturnValue(
          resolves({ ...lesson, archivedAt: ARCHIVED_AT }),
        ),
    ],
  ] as const)(
    '%s reports CONFLICT and cleans up nothing when DynamoDB refuses an item delete',
    async (procedure, input, arrange) => {
      arrange();
      contentItemQueryPrimary.mockReturnValue(
        resolves([
          textItem('item-1', {
            type: 'video',
            s3Key: 'key.mp4',
            mimeType: 'video/mp4',
          }),
        ]),
      );
      // The item's condition failed: its activity count is no longer 0.
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{ code: 'None' }, { code: 'ConditionalCheckFailed' }],
      });

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    },
  );
});
