/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  deleteContentItem,
  deleteContentItemPermanently,
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
  contentItemCreate,
  contentItemDelete,
  contentItemGet,
  contentItemPatch,
  contentItemQueryPrimary,
  courseCheck,
  courseGet,
  INSTRUCTOR_SUB,
  installDefaults,
  itemKey,
  lesson,
  lessonCreate,
  lessonGet,
  lessonKey,
  lessonPatch,
  module,
  moduleCreate,
  moduleGet,
  moduleKey,
  modulePatch,
  NOT_ARCHIVED,
  resolves,
  setCourseStatus,
  TEXT_BODY,
  textItem,
  transactionWrite,
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
  hideModule,
  publishModule,
  restoreModule,
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
  deleteContentItemPermanently,
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
  hideModule,
  publishModule,
  restoreModule,
  updateModule,
});

const callAs = () =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups: ['instructor'] });

beforeEach(installDefaults);

describe('delete in a published course', () => {
  beforeEach(() => {
    setCourseStatus('published');
  });

  // Invariant: outside a draft course, delete never destroys anything --
  // it only marks the record archived, so it (and every student's data for
  // it) can be restored. The write runs behind a check that the course isn't
  // archived.
  it('archives a module instead of deleting it and everything under it', async () => {
    moduleGet
      .mockReturnValueOnce(resolves(module))
      .mockReturnValueOnce(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    const result = await callAs().deleteModule(moduleKey);

    expect(transactionWrites).toEqual([
      courseCheck(),
      {
        entity: 'module',
        op: 'patch',
        key: moduleKey,
        set: { archivedAt: expect.any(String) },
      },
    ]);
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    expect(result.archivedAt).toBe(ARCHIVED_AT);
  });

  it('archives a lesson instead of deleting it and its content items', async () => {
    lessonGet
      .mockReturnValueOnce(resolves(lesson))
      .mockReturnValueOnce(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

    const result = await callAs().deleteLesson(lessonKey);

    expect(transactionWrites).toEqual([
      courseCheck(),
      {
        entity: 'lesson',
        op: 'patch',
        key: lessonKey,
        set: { archivedAt: expect.any(String) },
      },
    ]);
    expect(result.archivedAt).toBe(ARCHIVED_AT);
  });

  it('archives a video content item, keeping its S3 objects and transcode', async () => {
    const video = textItem('item-1', {
      type: 'video',
      s3Key: 'key.mp4',
      mimeType: 'video/mp4',
    });
    contentItemGet
      .mockReturnValueOnce(resolves(video))
      .mockReturnValueOnce(resolves({ ...video, archivedAt: ARCHIVED_AT }));

    await callAs().deleteContentItem(itemKey('item-1'));

    expect(transactionWrites).toEqual([
      courseCheck(),
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-1'),
        set: { archivedAt: expect.any(String) },
      },
    ]);
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('leaves an already archived module untouched, so a retry keeps the original archivedAt', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    const result = await callAs().deleteModule(moduleKey);

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result.archivedAt).toBe(ARCHIVED_AT);
  });

  it('leaves an already archived lesson untouched', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

    const result = await callAs().deleteLesson(lessonKey);

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result.archivedAt).toBe(ARCHIVED_AT);
  });

  it('leaves an already archived content item untouched', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
    );

    const result = await callAs().deleteContentItem(itemKey('item-1'));

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(result.archivedAt).toBe(ARCHIVED_AT);
  });
});

// An archived course is read-only: nothing in it is archived, restored,
// edited, published or hidden. Permanent delete of records that are already
// archived stays possible (see deletePermanently below).
describe('an archived course is read-only', () => {
  beforeEach(() => {
    setCourseStatus('archived');
  });

  it.each([
    ['deleteModule', moduleKey],
    ['updateModule', { ...moduleKey, title: 'New title' }],
    ['hideModule', moduleKey],
    ['publishModule', moduleKey],
    ['deleteLesson', lessonKey],
    ['updateLesson', { ...lessonKey, title: 'New title' }],
    ['hideLesson', lessonKey],
    ['publishLesson', lessonKey],
    ['deleteContentItem', itemKey('item-1')],
    ['publishContentItem', itemKey('item-1')],
    ['hideContentItem', itemKey('item-1')],
    ['updateContentItemText', { ...itemKey('item-1'), title: 'New title' }],
  ] as const)(
    '%s is refused with "Restore the course first", and writes nothing',
    async (procedure, input) => {
      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'restoreModule',
      moduleKey,
      () =>
        moduleGet.mockReturnValue(
          resolves({ ...module, archivedAt: ARCHIVED_AT }),
        ),
    ],
    [
      'restoreLesson',
      lessonKey,
      () =>
        lessonGet.mockReturnValue(
          resolves({ ...lesson, archivedAt: ARCHIVED_AT }),
        ),
    ],
    [
      'restoreContentItem',
      itemKey('item-1'),
      () =>
        contentItemGet.mockReturnValue(
          resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
        ),
    ],
  ] as const)(
    '%s is refused with "Restore the course first", and writes nothing',
    async (procedure, input, arrange) => {
      arrange();

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  // Invariant: the only edit left in an archived course is cleaning up records
  // that are already archived, so it can be tidied without restoring it (which
  // would show it to students again). Those deletes don't need the course
  // check, and are still guarded by the record being archived and having no
  // student activity.
  it('still permanently deletes an archived module, and everything under it', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    await callAs().deleteModulePermanently(moduleKey);

    expect(transactionWrites).toEqual([
      expect.objectContaining({
        entity: 'module',
        op: 'delete',
        key: moduleKey,
      }),
    ]);
  });

  it('still permanently deletes an archived lesson, and its content items', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(resolves([textItem('item-1')]));

    await callAs().deleteLessonPermanently(lessonKey);

    expect(
      transactionWrites.map(({ entity, op }) => `${entity} ${op}`),
    ).toEqual(['lesson delete', 'contentItem delete']);
  });

  it('still permanently deletes an archived content item', async () => {
    const item = textItem('item-1', { archivedAt: ARCHIVED_AT });
    contentItemGet.mockReturnValue(resolves(item));
    contentItemDelete.mockReturnValue({
      where: () => ({ go: vi.fn().mockResolvedValue({ data: item }) }),
    });

    await callAs().deleteContentItemPermanently(itemKey('item-1'));

    expect(contentItemDelete).toHaveBeenCalledWith(itemKey('item-1'));
  });
});

describe('missing records', () => {
  // Invariant: a create can't produce a record under a course that doesn't
  // exist (its visibility depends on the course's status).
  it.each([
    ['createModule', { courseId: COURSE_ID, title: 'New module' }],
    ['createLesson', { ...moduleKey, title: 'New lesson' }],
    [
      'createContentItemText',
      { ...lessonKey, title: 'New text', body: TEXT_BODY },
    ],
  ] as const)(
    '%s throws NOT_FOUND when the course does not exist',
    async (procedure, input) => {
      courseGet.mockReturnValue(resolves(null));

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(moduleCreate).not.toHaveBeenCalled();
      expect(lessonCreate).not.toHaveBeenCalled();
      expect(contentItemCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['publishModule', moduleKey, moduleGet],
    ['hideModule', moduleKey, moduleGet],
    ['restoreModule', moduleKey, moduleGet],
    ['deleteModulePermanently', moduleKey, moduleGet],
    ['publishLesson', lessonKey, lessonGet],
    ['hideLesson', lessonKey, lessonGet],
    ['restoreLesson', lessonKey, lessonGet],
    ['deleteLessonPermanently', lessonKey, lessonGet],
    ['publishContentItem', itemKey('item-1'), contentItemGet],
    ['hideContentItem', itemKey('item-1'), contentItemGet],
    ['restoreContentItem', itemKey('item-1'), contentItemGet],
    ['deleteContentItemPermanently', itemKey('item-1'), contentItemGet],
  ] as const)(
    '%s throws NOT_FOUND, writing nothing, when the record does not exist',
    async (procedure, input, get) => {
      get.mockReturnValue(resolves(null));

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(modulePatch).not.toHaveBeenCalled();
      expect(lessonPatch).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
      expect(contentItemDelete).not.toHaveBeenCalled();
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['module', moduleGet],
    ['lesson', lessonGet],
  ] as const)(
    'restoreContentItem throws NOT_FOUND when its %s no longer exists',
    async (_ancestor, get) => {
      contentItemGet.mockReturnValue(
        resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
      );
      get.mockReturnValue(resolves(null));

      await expect(
        callAs().restoreContentItem(itemKey('item-1')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(contentItemPatch).not.toHaveBeenCalled();
    },
  );
});

describe('editing an archived record', () => {
  // Invariant: an archived record must be restored before it's edited.
  it.each([
    [
      'updateModule',
      { ...moduleKey, title: 'New title' },
      moduleGet,
      { ...module, archivedAt: ARCHIVED_AT },
      'Restore the module before editing it',
    ],
    [
      'updateLesson',
      { ...lessonKey, title: 'New title' },
      lessonGet,
      { ...lesson, archivedAt: ARCHIVED_AT },
      'Restore the lesson before editing it',
    ],
    [
      'updateContentItemText',
      { ...itemKey('item-1'), title: 'New title' },
      contentItemGet,
      textItem('item-1', { archivedAt: ARCHIVED_AT }),
      'Restore the content item before editing it',
    ],
  ] as const)(
    '%s refuses and writes nothing',
    async (procedure, input, get, record, message) => {
      get.mockReturnValue(resolves(record));

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message,
      });
      expect(modulePatch).not.toHaveBeenCalled();
      expect(lessonPatch).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
    },
  );

  it('updateModule still edits a module that is not archived', async () => {
    await callAs().updateModule({ ...moduleKey, title: 'New title' });

    expect(transactionWrites).toEqual([
      courseCheck(),
      {
        entity: 'module',
        op: 'patch',
        key: moduleKey,
        set: { title: 'New title' },
        condition: NOT_ARCHIVED,
      },
    ]);
  });

  it.each([
    [
      'updateLesson',
      { ...lessonKey, title: 'New title' },
      [courseCheck(), ancestorCheck('module', moduleKey)],
      { entity: 'lesson', key: lessonKey },
    ],
    [
      'updateContentItemText',
      { ...itemKey('item-1'), title: 'New title' },
      [
        courseCheck(),
        ancestorCheck('module', moduleKey),
        ancestorCheck('lesson', lessonKey),
      ],
      { entity: 'contentItem', key: itemKey('item-1') },
    ],
  ] as const)(
    '%s still edits a record that is not archived',
    async (procedure, input, checks, target) => {
      await (callAs() as any)[procedure](input);

      expect(transactionWrites).toEqual([
        ...checks,
        {
          ...target,
          op: 'patch',
          set: { title: 'New title' },
          condition: NOT_ARCHIVED,
        },
      ]);
    },
  );
});

describe('under an archived module or lesson', () => {
  // Invariant: an archived module or lesson freezes everything under it --
  // nothing beneath it can be added, edited, published or hidden until it's
  // restored, so a restore brings back exactly what was archived.
  const archivedModule = () =>
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
  const archivedLesson = () =>
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

  it.each([
    ['updateLesson', { ...lessonKey, title: 'New title' }],
    ['publishLesson', lessonKey],
    ['hideLesson', lessonKey],
    [
      'createContentItemText',
      { ...lessonKey, title: 'New text', body: TEXT_BODY },
    ],
    ['updateContentItemText', { ...itemKey('item-1'), title: 'New title' }],
    ['publishContentItem', itemKey('item-1')],
    ['hideContentItem', itemKey('item-1')],
  ] as const)(
    '%s is refused when the module is archived, writing nothing',
    async (procedure, input) => {
      archivedModule();
      lessonGet.mockReturnValue(resolves({ ...lesson, visibility: 'hidden' }));
      contentItemGet.mockReturnValue(
        resolves(textItem('item-1', { visibility: 'hidden' })),
      );

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the module first',
      });
      expect(lessonPatch).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
      expect(contentItemCreate).not.toHaveBeenCalled();
      expect(transactionWrite).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['updateContentItemText', { ...itemKey('item-1'), title: 'New title' }],
    ['publishContentItem', itemKey('item-1')],
    ['hideContentItem', itemKey('item-1')],
  ] as const)(
    '%s is refused when the lesson is archived, writing nothing',
    async (procedure, input) => {
      archivedLesson();
      contentItemGet.mockReturnValue(
        resolves(textItem('item-1', { visibility: 'hidden' })),
      );

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the lesson first',
      });
      expect(contentItemPatch).not.toHaveBeenCalled();
    },
  );

  // The module is checked first, matching the order restores must happen
  // in.
  it('names the module when both the module and the lesson are archived', async () => {
    archivedModule();
    archivedLesson();

    await expect(
      callAs().publishContentItem(itemKey('item-1')),
    ).rejects.toMatchObject({ message: 'Restore the module first' });
  });

  it.each([
    [
      'hideLesson',
      lessonKey,
      lessonGet,
      { ...lesson, archivedAt: ARCHIVED_AT },
    ],
    [
      'hideContentItem',
      itemKey('item-1'),
      contentItemGet,
      textItem('item-1', { archivedAt: ARCHIVED_AT }),
    ],
  ] as const)(
    '%s refuses an archived record itself, writing nothing',
    async (procedure, input, get, record) => {
      get.mockReturnValue(resolves(record));

      await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(lessonPatch).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
    },
  );
});

describe('remaining edge cases', () => {
  it('restoreLesson throws NOT_FOUND when its module no longer exists', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    moduleGet.mockReturnValue(resolves(null));

    await expect(callAs().restoreLesson(lessonKey)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(lessonPatch).not.toHaveBeenCalled();
  });

  it('deleteContentItemPermanently rethrows a failure that is not a condition check, rather than reporting CONFLICT', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
    );
    contentItemDelete.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(new Error('Throttled')),
      }),
    });

    await expect(
      callAs().deleteContentItemPermanently(itemKey('item-1')),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('deleteContentItemPermanently reports INTERNAL_SERVER_ERROR when the delete returns no record', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
    );
    contentItemDelete.mockReturnValue({
      where: () => ({ go: vi.fn().mockResolvedValue({ data: null }) }),
    });

    await expect(
      callAs().deleteContentItemPermanently(itemKey('item-1')),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('deleteContentItemPermanently deletes an archived text item without any S3 or transcode cleanup', async () => {
    const text = textItem('item-1', { archivedAt: ARCHIVED_AT });
    contentItemGet.mockReturnValue(resolves(text));
    contentItemDelete.mockReturnValue({
      where: () => ({ go: vi.fn().mockResolvedValue({ data: text }) }),
    });

    await callAs().deleteContentItemPermanently(itemKey('item-1'));

    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });
});
