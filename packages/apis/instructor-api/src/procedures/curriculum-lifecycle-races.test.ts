/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../init.js';
import {
  deleteContentItem,
  hideContentItem,
  publishContentItem,
  restoreContentItem,
} from './content-item-shared.js';
import {
  createContentItemText,
  updateContentItemText,
} from './content-item-text.js';
import {
  ARCHIVED_AT,
  ancestorCheck,
  COURSE_ID,
  claimed,
  contentItemGet,
  contentItemQueryPrimary,
  courseCheck,
  courseGet,
  draftCourseCheck,
  INSTRUCTOR_SUB,
  installDefaults,
  itemKey,
  lesson,
  lessonGet,
  lessonKey,
  lessonQueryPrimary,
  module,
  moduleGet,
  moduleKey,
  NOT_ARCHIVED,
  resolves,
  TEXT_BODY,
  textItem,
  transactionGo,
  transactionWrites,
} from './curriculum-lifecycle.fixtures.js';
import {
  createLesson,
  deleteLesson,
  deleteLessonPermanently,
  hideLesson,
  publishLesson,
  restoreLesson,
  updateLesson,
} from './lesson.js';
import {
  createModule,
  deleteModule,
  deleteModulePermanently,
  publishModule,
  updateModule,
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
  deleteContentItem,
  hideContentItem,
  publishContentItem,
  restoreContentItem,
  createContentItemText,
  updateContentItemText,
  createLesson,
  deleteLesson,
  deleteLessonPermanently,
  hideLesson,
  publishLesson,
  restoreLesson,
  updateLesson,
  createModule,
  deleteModule,
  deleteModulePermanently,
  publishModule,
  updateModule,
});

const callAs = () =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups: ['instructor'] });

beforeEach(installDefaults);

describe('parent restored while being permanently deleted', () => {
  // The transaction's first result is the parent's; DynamoDB reports
  // ConditionalCheckFailed there when the restore landed after the
  // archivedAt check, and the whole transaction is canceled.
  const parentRestored = {
    canceled: true,
    data: [{ code: 'ConditionalCheckFailed' }, { code: 'None' }],
  };

  it('deleteModulePermanently throws CONFLICT and cleans up nothing', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-1', {
          type: 'video',
          s3Key: 'key.mp4',
          mimeType: 'video/mp4',
        }),
      ]),
    );
    transactionGo.mockResolvedValue(parentRestored);

    await expect(
      callAs().deleteModulePermanently(moduleKey),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'The module was restored or changed while it was being deleted; nothing was deleted',
    });
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('deleteLessonPermanently throws CONFLICT and cleans up nothing', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(resolves([textItem('item-1')]));
    transactionGo.mockResolvedValue(parentRestored);

    await expect(
      callAs().deleteLessonPermanently(lessonKey),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message:
        'The lesson was restored or changed while it was being deleted; nothing was deleted',
    });
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  // Draft courses keep their unconditional hard delete: nothing there is
  // ever archived, so there's no archive state to check.
  it('a draft-course delete leaves the parent delete unconditional, but only lands while the course is still a draft', async () => {
    await callAs().deleteModule(moduleKey);
    expect(transactionWrites).toEqual([
      { entity: 'module', op: 'delete', key: moduleKey },
      draftCourseCheck(moduleKey.courseId),
    ]);

    await callAs().deleteLesson(lessonKey);
    expect(transactionWrites).toEqual([
      { entity: 'lesson', op: 'delete', key: lessonKey },
      draftCourseCheck(lessonKey.courseId),
    ]);
  });

  // Invariant: a delete that read the course as a draft can't destroy anything
  // once the course has been published; it asks for a retry, which archives.
  it.each([
    ['module', 'deleteModule', () => moduleKey],
    ['lesson', 'deleteLesson', () => lessonKey],
  ] as const)(
    'a %s delete is refused when the course was published after the status read',
    async (_, procedure, key) => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, { code: 'ConditionalCheckFailed' }],
      });

      await expect(
        callAs()[procedure](key() as typeof lessonKey),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('was published'),
      });
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    },
  );

  // A concurrent transaction on the same records is cancelled with
  // TransactionConflict, not a failed condition: a retryable conflict.
  it.each([
    ['lesson', 'deleteLesson', () => lessonKey],
    ['module', 'deleteModule', () => moduleKey],
  ] as const)(
    'a %s delete reports CONFLICT, not a server error, for a transaction conflict',
    async (_, procedure, key) => {
      lessonQueryPrimary.mockReturnValue(resolves([lesson]));
      contentItemQueryPrimary.mockReturnValue(resolves([textItem('item-1')]));
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{ code: 'TransactionConflict' }, {}, {}, {}],
      });

      await expect(
        callAs()[procedure](key() as typeof lessonKey),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
    },
  );

  // With content items in the transaction, the draft check is still told
  // apart from a changed item: the draft check is always the last result.
  it.each([
    ['lesson', 'deleteLesson', () => lessonKey, 'in this lesson'],
    ['module', 'deleteModule', () => moduleKey, 'in this module'],
  ] as const)(
    'a %s delete reports a changed content item, not a publish, when only an item failed its condition',
    async (_, procedure, key, where) => {
      lessonQueryPrimary.mockReturnValue(resolves([lesson]));
      contentItemQueryPrimary.mockReturnValue(
        resolves([textItem('item-1'), textItem('item-2')]),
      );
      // The lesson/module, two items (the first one failed), the draft check.
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, { code: 'ConditionalCheckFailed' }, {}, {}, {}],
      });

      const error = await callAs()
        [procedure](key() as typeof lessonKey)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: 'CONFLICT' });
      expect((error as Error).message).toContain(where);
      expect((error as Error).message).not.toContain('was published');
    },
  );

  it.each([
    ['lesson', 'deleteLesson', () => lessonKey],
    ['module', 'deleteModule', () => moduleKey],
  ] as const)(
    'a %s delete with content items reports the publish when the draft check, the last result, failed',
    async (_, procedure, key) => {
      lessonQueryPrimary.mockReturnValue(resolves([lesson]));
      contentItemQueryPrimary.mockReturnValue(
        resolves([textItem('item-1'), textItem('item-2')]),
      );
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, {}, {}, {}, { code: 'ConditionalCheckFailed' }],
      });

      await expect(
        callAs()[procedure](key() as typeof lessonKey),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('was published'),
      });
    },
  );
});

describe('parent archived between the checks and the write', () => {
  // Invariant: the frozen-subtree guarantee holds even when requests overlap.
  // Each write runs in one transaction with checks that its module (and
  // lesson) still exist and aren't archived, so an archive landing after the
  // procedure's own checks cancels the whole write. Here the module or lesson
  // reads as active for those checks, then DynamoDB refuses the transaction
  // because the ancestor has since been archived.
  const archivedModule = { ...module, archivedAt: ARCHIVED_AT };
  const archivedLesson = { ...lesson, archivedAt: ARCHIVED_AT };
  const refusedAt = (index: number) => ({
    canceled: true,
    data: Array.from({ length: index + 2 }, (_, i) => ({
      code: i === index ? 'ConditionalCheckFailed' : 'None',
    })),
  });

  it.each([
    ['createLesson', { ...moduleKey, title: 'New lesson' }],
    ['updateLesson', { ...lessonKey, title: 'New title' }],
    ['publishLesson', lessonKey],
    ['hideLesson', lessonKey],
    ['restoreLesson', lessonKey],
    [
      'createContentItemText',
      { ...lessonKey, title: 'New text', body: TEXT_BODY },
    ],
    ['updateContentItemText', { ...itemKey('item-1'), title: 'New title' }],
    ['publishContentItem', itemKey('item-1')],
    ['hideContentItem', itemKey('item-1')],
    ['restoreContentItem', itemKey('item-1')],
  ] as const)(
    '%s is refused when the module is archived in the meantime',
    async (procedure, input) => {
      // Read as active by the procedure's own checks, archived on the re-check
      // after the transaction is refused.
      moduleGet
        .mockReturnValueOnce(resolves(module))
        .mockReturnValue(resolves(archivedModule));
      lessonGet.mockReturnValue(
        resolves(
          procedure === 'restoreLesson'
            ? archivedLesson
            : {
                ...lesson,
                visibility: procedure === 'hideLesson' ? 'visible' : 'hidden',
              },
        ),
      );
      contentItemGet.mockReturnValue(
        resolves(
          textItem('item-1', {
            // Hiding needs a visible item, publishing a hidden one.
            visibility: procedure.startsWith('hide') ? 'visible' : 'hidden',
            ...(procedure === 'restoreContentItem' && {
              archivedAt: ARCHIVED_AT,
            }),
          }),
        ),
      );
      // The course check is first, then the module's.
      transactionGo.mockResolvedValue(refusedAt(1));

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the module first',
      });
      // The write was only ever attempted inside the guarded transaction.
      const moduleCheck = ancestorCheck('module', moduleKey);
      expect(transactionWrites.slice(0, 2)).toEqual([
        courseCheck(),
        procedure === 'createLesson' || procedure === 'restoreLesson'
          ? claimed(moduleCheck)
          : moduleCheck,
      ]);
    },
  );

  it.each([
    [
      'createContentItemText',
      { ...lessonKey, title: 'New text', body: TEXT_BODY },
    ],
    ['updateContentItemText', { ...itemKey('item-1'), title: 'New title' }],
    ['publishContentItem', itemKey('item-1')],
    ['hideContentItem', itemKey('item-1')],
    ['restoreContentItem', itemKey('item-1')],
  ] as const)(
    '%s is refused when the lesson is archived in the meantime',
    async (procedure, input) => {
      lessonGet
        .mockReturnValueOnce(resolves(lesson))
        .mockReturnValue(resolves(archivedLesson));
      contentItemGet.mockReturnValue(
        resolves(
          textItem('item-1', {
            // Hiding needs a visible item, publishing a hidden one.
            visibility: procedure.startsWith('hide') ? 'visible' : 'hidden',
            ...(procedure === 'restoreContentItem' && {
              archivedAt: ARCHIVED_AT,
            }),
          }),
        ),
      );
      // The course check is first, then the module's, then the lesson's.
      transactionGo.mockResolvedValue(refusedAt(2));

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the lesson first',
      });
      const lessonCheck = ancestorCheck('lesson', lessonKey);
      expect(transactionWrites.slice(0, 3)).toEqual([
        courseCheck(),
        ancestorCheck('module', moduleKey),
        procedure === 'createContentItemText' ||
        procedure === 'restoreContentItem'
          ? claimed(lessonCheck)
          : lessonCheck,
      ]);
    },
  );

  it('reports CONFLICT when an ancestor check fails but the ancestor reads as active again', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, visibility: 'hidden' }));
    // The course check is first, then the module's.
    transactionGo.mockResolvedValue(refusedAt(1));

    await expect(callAs().publishLesson(lessonKey)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('reports NOT_FOUND when the module was deleted in the meantime', async () => {
    moduleGet
      .mockReturnValueOnce(resolves(module))
      .mockReturnValue(resolves(null));
    transactionGo.mockResolvedValue(refusedAt(1));

    await expect(
      callAs().createLesson({ ...moduleKey, title: 'New lesson' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a descendant archived while a publish is in flight', () => {
  // Invariant: a publish never changes a lesson or item archived after its
  // query -- restoring it later would otherwise bring it back visible rather
  // than as it was archived. Every lesson and item patch in the cascade (and,
  // in publishModule, every item's lesson) is conditioned on not being
  // archived, so DynamoDB refuses the whole transaction instead.
  const refusedAt = (index: number, length: number) => ({
    canceled: true,
    data: Array.from({ length }, (_, i) => ({
      code: i === index ? 'ConditionalCheckFailed' : 'None',
    })),
  });

  it('publishLesson conditions every item patch on the item not being archived', async () => {
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-a', { visibility: 'hidden' }),
        textItem('item-b', { visibility: 'hidden' }),
      ]),
    );

    await callAs().publishLesson(lessonKey);

    const itemWrites = transactionWrites.filter(
      ({ entity }) => entity === 'contentItem',
    );
    expect(itemWrites).toHaveLength(2);
    for (const write of itemWrites) {
      expect(write.condition).toBe(NOT_ARCHIVED);
    }
  });

  it('publishLesson is refused with CONFLICT when an item is archived in the meantime', async () => {
    contentItemQueryPrimary.mockReturnValue(
      resolves([textItem('item-a', { visibility: 'hidden' })]),
    );
    // [course check, module check, lesson check, item patch]: a write past
    // the ancestor checks (index 2 here) failed its condition.
    transactionGo.mockResolvedValue(refusedAt(2, 3));

    await expect(callAs().publishLesson(lessonKey)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('publishModule conditions every lesson and item patch, and checks the lesson of every item it publishes', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, visibility: 'hidden' }));
    lessonQueryPrimary.mockReturnValue(
      resolves([
        { ...lesson, lessonId: 'lesson-hidden', visibility: 'hidden' },
        lesson,
      ]),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-in-hidden-lesson', {
          lessonId: 'lesson-hidden',
          visibility: 'hidden',
        }),
        textItem('item-in-visible-lesson', { visibility: 'hidden' }),
      ]),
    );

    await callAs().publishModule(moduleKey);

    expect(transactionWrites).toEqual([
      {
        entity: 'module',
        op: 'patch',
        key: moduleKey,
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'lesson',
        op: 'patch',
        key: { ...moduleKey, lessonId: 'lesson-hidden' },
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      // The visible lesson isn't published, but its item is: checked.
      {
        entity: 'lesson',
        op: 'check',
        key: lessonKey,
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'contentItem',
        op: 'patch',
        key: {
          ...moduleKey,
          lessonId: 'lesson-hidden',
          contentItemId: 'item-in-hidden-lesson',
        },
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-in-visible-lesson'),
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      courseCheck(),
    ]);
  });

  // The transaction is [module check, lesson patch or check, item patch,
  // course check]; the module is visible, so it's only checked.
  it.each([
    ['a lesson it publishes', 'hidden', 1],
    ["an item's lesson it doesn't publish", 'visible', 1],
    ['an item it publishes', 'visible', 2],
  ] as const)(
    'publishModule is refused with CONFLICT when %s is archived in the meantime',
    async (_what, lessonVisibility, index) => {
      lessonQueryPrimary.mockReturnValue(
        resolves([{ ...lesson, visibility: lessonVisibility }]),
      );
      contentItemQueryPrimary.mockReturnValue(
        resolves([textItem('item-a', { visibility: 'hidden' })]),
      );
      transactionGo.mockResolvedValue(refusedAt(index, 3));

      await expect(callAs().publishModule(moduleKey)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(transactionWrites[index]).toMatchObject({
        entity: index === 1 ? 'lesson' : 'contentItem',
        op: index === 1 && lessonVisibility === 'visible' ? 'check' : 'patch',
        condition: NOT_ARCHIVED,
      });
    },
  );
});

// An archived course is read-only, but a check made from an earlier read can
// be overtaken by the course being archived. Every write is therefore also
// conditioned on the course not being archived, in the same transaction.
describe('course archived between the checks and the write', () => {
  // The course reads as published until a transaction is attempted, then as
  // archived: the archive landed after the procedure's own checks, and the
  // course check at the head of the transaction is what cancels the write.
  const archiveWhenWriting = (results: unknown) => {
    let archived = false;
    courseGet.mockImplementation(() =>
      resolves({
        courseId: COURSE_ID,
        status: archived ? 'archived' : 'published',
      }),
    );
    transactionGo.mockImplementation(async () => {
      archived = true;
      return results;
    });
  };
  const courseCheckFailed = {
    canceled: true,
    data: [{ code: 'ConditionalCheckFailed' }, { code: 'None' }],
  };

  it.each([
    ['createModule', { courseId: COURSE_ID, title: 'New module' }],
    ['updateModule', { ...moduleKey, title: 'New title' }],
    ['deleteModule', moduleKey],
    ['createLesson', { ...moduleKey, title: 'New lesson' }],
    ['updateLesson', { ...lessonKey, title: 'New title' }],
    ['deleteLesson', lessonKey],
    [
      'createContentItemText',
      { ...lessonKey, title: 'New text', body: TEXT_BODY },
    ],
    ['updateContentItemText', { ...itemKey('item-1'), title: 'New title' }],
    ['deleteContentItem', itemKey('item-1')],
  ] as const)(
    '%s is refused with "Restore the course first" when the course is archived in the meantime',
    async (procedure, input) => {
      contentItemGet.mockReturnValue(resolves(textItem('item-1')));
      archiveWhenWriting(courseCheckFailed);

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
      // The write was only ever attempted behind the course check.
      expect(transactionWrites[0]).toEqual(
        procedure === 'createModule' ? claimed(courseCheck()) : courseCheck(),
      );
    },
  );

  it('publishModule is refused when the course is archived in the meantime', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, visibility: 'hidden' }));
    // The course check is the transaction's last item.
    archiveWhenWriting({
      canceled: true,
      data: [{ code: 'None' }, { code: 'ConditionalCheckFailed' }],
    });

    await expect(callAs().publishModule(moduleKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(transactionWrites.at(-1)).toEqual(courseCheck());
  });
});
