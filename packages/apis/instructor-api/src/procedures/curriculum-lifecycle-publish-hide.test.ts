/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../init.js';
import {
  deleteContentItemPermanently,
  hideContentItem,
  publishContentItem,
  restoreContentItem,
} from './content-item-shared.js';
import { createContentItemText } from './content-item-text.js';
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
  courseInstructorGet,
  createdRecords,
  INSTRUCTOR_SUB,
  installDefaults,
  itemKey,
  lesson,
  lessonCreate,
  lessonGet,
  lessonKey,
  lessonPatch,
  lessonQueryPrimary,
  module,
  moduleGet,
  moduleKey,
  modulePatch,
  NOT_ARCHIVED,
  resolves,
  setCourseStatus,
  TEXT_BODY,
  textItem,
  transactionGo,
  transactionWrite,
  transactionWrites,
} from './curriculum-lifecycle.fixtures.js';
import {
  createLesson,
  deleteLessonPermanently,
  hideLesson,
  publishLesson,
  restoreLesson,
} from './lesson.js';
import {
  createModule,
  deleteModulePermanently,
  hideModule,
  publishModule,
  restoreModule,
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
  hideContentItem,
  publishContentItem,
  restoreContentItem,
  createContentItemText,
  createLesson,
  deleteLessonPermanently,
  hideLesson,
  publishLesson,
  restoreLesson,
  createModule,
  deleteModulePermanently,
  hideModule,
  publishModule,
  restoreModule,
});

const callAs = () =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups: ['instructor'] });

beforeEach(installDefaults);

// Invariant: every lifecycle procedure is limited to instructors teaching the
// course, and writes nothing otherwise.
describe.each([
  ['publishModule', moduleKey],
  ['hideModule', moduleKey],
  ['restoreModule', moduleKey],
  ['deleteModulePermanently', moduleKey],
  ['publishLesson', lessonKey],
  ['hideLesson', lessonKey],
  ['restoreLesson', lessonKey],
  ['deleteLessonPermanently', lessonKey],
  ['publishContentItem', itemKey('item-1')],
  ['hideContentItem', itemKey('item-1')],
  ['restoreContentItem', itemKey('item-1')],
  ['deleteContentItemPermanently', itemKey('item-1')],
] as const)('%s', (procedure, input) => {
  it('throws FORBIDDEN, writing nothing, when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue(resolves(undefined));

    await expect((callAs() as any)[procedure](input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(modulePatch).not.toHaveBeenCalled();
    expect(lessonPatch).not.toHaveBeenCalled();
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('visibility of new records', () => {
  // Invariant: a draft course has never been open to students, so new
  // records are visible straight away; in any other course they start
  // hidden, so students never see something half-built.
  it.each([
    ['draft', 'visible'],
    ['published', 'hidden'],
  ] as const)(
    'in a %s course, new modules, lessons and content items are %s',
    async (status, visibility) => {
      setCourseStatus(status);

      await callAs().createModule({
        courseId: COURSE_ID,
        title: 'New module',
      });
      await callAs().createLesson({
        ...moduleKey,
        title: 'New lesson',
      });
      await callAs().createContentItemText({
        ...lessonKey,
        title: 'New text',
        body: TEXT_BODY,
      });

      // What was written, not what was read back.
      for (const entity of ['module', 'lesson', 'contentItem']) {
        expect(
          createdRecords.findLast((record) => record.entity === entity)?.values
            .visibility,
        ).toBe(visibility);
      }
    },
  );

  // An archived course is read-only: nothing is added to it.
  it('refuses to add a module, lesson or content item to an archived course', async () => {
    setCourseStatus('archived');

    await expect(
      callAs().createModule({ courseId: COURSE_ID, title: 'New module' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(
      callAs().createLesson({ ...moduleKey, title: 'New lesson' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(
      callAs().createContentItemText({
        ...lessonKey,
        title: 'New text',
        body: TEXT_BODY,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(createdRecords).toEqual([]);
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to add a lesson to an archived module', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    await expect(
      callAs().createLesson({ ...moduleKey, title: 'New lesson' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(lessonCreate).not.toHaveBeenCalled();
  });

  it('refuses to add content to an archived lesson', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

    await expect(
      callAs().createContentItemText({
        ...lessonKey,
        title: 'New text',
        body: TEXT_BODY,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });
});

describe('publishModule', () => {
  // Invariant: publishing a module shows it complete, all at once -- the
  // module and every hidden, unarchived lesson and content item under it
  // are published in one transaction. Archived records, and content items
  // under an archived lesson, are left alone.
  it('publishes the module and its hidden descendants in one transaction', async () => {
    moduleGet
      .mockReturnValueOnce(resolves({ ...module, visibility: 'hidden' }))
      .mockReturnValueOnce(resolves(module));
    lessonQueryPrimary.mockReturnValue(
      resolves([
        { ...lesson, visibility: 'hidden' },
        { ...lesson, lessonId: 'lesson-visible' },
        {
          ...lesson,
          lessonId: 'lesson-archived',
          visibility: 'hidden',
          archivedAt: ARCHIVED_AT,
        },
      ]),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-hidden', { visibility: 'hidden' }),
        textItem('item-visible'),
        textItem('item-archived', {
          visibility: 'hidden',
          archivedAt: ARCHIVED_AT,
        }),
        textItem('item-under-archived-lesson', {
          lessonId: 'lesson-archived',
          visibility: 'hidden',
        }),
      ]),
    );

    const result = await callAs().publishModule(moduleKey);

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
        key: lessonKey,
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-hidden'),
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      courseCheck(),
    ]);
    expect(result).toEqual(module);
  });

  it('writes nothing when the module and everything under it are already visible', async () => {
    lessonQueryPrimary.mockReturnValue(resolves([lesson]));
    contentItemQueryPrimary.mockReturnValue(resolves([textItem('item-1')]));

    await callAs().publishModule(moduleKey);

    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses to publish an archived module', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    await expect(callAs().publishModule(moduleKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when the transaction is canceled', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, visibility: 'hidden' }));
    transactionGo.mockResolvedValue({ canceled: true, data: [] });

    await expect(callAs().publishModule(moduleKey)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('publishLesson', () => {
  it('publishes the lesson and its hidden, unarchived content items in one transaction', async () => {
    lessonGet
      .mockReturnValueOnce(resolves({ ...lesson, visibility: 'hidden' }))
      .mockReturnValueOnce(resolves(lesson));
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-hidden', { visibility: 'hidden' }),
        textItem('item-visible'),
        textItem('item-archived', {
          visibility: 'hidden',
          archivedAt: ARCHIVED_AT,
        }),
      ]),
    );

    const result = await callAs().publishLesson(lessonKey);

    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      {
        entity: 'lesson',
        op: 'patch',
        key: lessonKey,
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-hidden'),
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
    ]);
    expect(result).toEqual({ ...lesson, freePreview: false });
  });

  it('refuses to publish an archived lesson', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

    await expect(callAs().publishLesson(lessonKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(transactionWrite).not.toHaveBeenCalled();
  });
});

describe('publishContentItem and hide*', () => {
  // Written in one transaction behind checks that the module and lesson
  // are still active, conditioned on the item still not being archived; the
  // result is read back afterwards.
  it('publishes a hidden content item', async () => {
    contentItemGet.mockReturnValueOnce(
      resolves(textItem('item-1', { visibility: 'hidden' })),
    );

    const result = await callAs().publishContentItem(itemKey('item-1'));

    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      ancestorCheck('lesson', lessonKey),
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-1'),
        set: { visibility: 'visible', publishedAt: expect.any(String) },
        condition: NOT_ARCHIVED,
      },
    ]);
    expect(result.visibility).toBe('visible');
  });

  it('refuses to publish an archived content item', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
    );

    await expect(
      callAs().publishContentItem(itemKey('item-1')),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  // Hiding is not cascaded: children keep their own visibility (students
  // stop seeing them anyway, since a record is only shown under visible
  // ancestors).
  it('hides only the module itself', async () => {
    await callAs().hideModule(moduleKey);

    // Only the module is written, behind the course check.
    expect(transactionWrites).toEqual([
      courseCheck(),
      {
        entity: 'module',
        op: 'patch',
        key: moduleKey,
        set: { visibility: 'hidden' },
        condition: NOT_ARCHIVED,
      },
    ]);
  });

  it('hides a lesson and a content item', async () => {
    await callAs().hideLesson(lessonKey);
    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      {
        entity: 'lesson',
        op: 'patch',
        key: lessonKey,
        set: { visibility: 'hidden' },
        condition: NOT_ARCHIVED,
      },
    ]);

    await callAs().hideContentItem(itemKey('item-1'));
    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      ancestorCheck('lesson', lessonKey),
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-1'),
        set: { visibility: 'hidden' },
        condition: NOT_ARCHIVED,
      },
    ]);
  });

  it('refuses to hide an archived record', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    await expect(callAs().hideModule(moduleKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('repeating an operation writes nothing', () => {
  // Retrying a request that already succeeded (e.g. after a client-side
  // timeout) returns the record as it is, without another write.
  it('publishing an already visible content item', async () => {
    const result = await callAs().publishContentItem(itemKey('item-1'));

    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(result.visibility).toBe('visible');
  });

  it('publishing a visible lesson with nothing hidden in it', async () => {
    contentItemQueryPrimary.mockReturnValue(resolves([textItem('item-1')]));

    await callAs().publishLesson(lessonKey);

    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it.each([
    ['hideModule', moduleKey, moduleGet, { ...module, visibility: 'hidden' }],
    ['hideLesson', lessonKey, lessonGet, { ...lesson, visibility: 'hidden' }],
    [
      'hideContentItem',
      itemKey('item-1'),
      contentItemGet,
      textItem('item-1', { visibility: 'hidden' }),
    ],
  ] as const)(
    '%s on a record that is already hidden',
    async (procedure, input, get, record) => {
      get.mockReturnValue(resolves(record));

      const result = await (callAs() as any)[procedure](input);

      expect(modulePatch).not.toHaveBeenCalled();
      expect(lessonPatch).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
      expect(result.visibility).toBe('hidden');
    },
  );

  it('restoring a lesson that is not archived', async () => {
    const result = await callAs().restoreLesson(lessonKey);

    expect(lessonPatch).not.toHaveBeenCalled();
    expect(moduleGet).not.toHaveBeenCalled();
    expect(result.archivedAt).toBeUndefined();
  });

  it('restoring a content item that is not archived', async () => {
    const result = await callAs().restoreContentItem(itemKey('item-1'));

    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(result.archivedAt).toBeUndefined();
  });
});

describe('publishLesson conflicts', () => {
  it('throws CONFLICT when the transaction is canceled', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, visibility: 'hidden' }));
    // The lesson's own write was refused although it's still not archived
    // (e.g. changed by another request): a retryable CONFLICT.
    transactionGo.mockResolvedValue({
      canceled: true,
      data: [{ code: 'None' }, { code: 'ConditionalCheckFailed' }],
    });

    await expect(callAs().publishLesson(lessonKey)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

// Invariant: publishing a module or lesson publishes only hidden descendants
// that have never been published -- content that's new. One hidden on purpose
// after it was visible (it has a publishedAt) stays hidden.
describe('publishing leaves content hidden on purpose alone', () => {
  const PUBLISHED_AT = '2024-01-15T00:00:00.000Z';

  it('publishModule publishes a new lesson and item, but not ones hidden after they were visible', async () => {
    moduleGet
      .mockReturnValueOnce(resolves({ ...module, publishedAt: PUBLISHED_AT }))
      .mockReturnValueOnce(resolves(module));
    lessonQueryPrimary.mockReturnValue(
      resolves([
        { ...lesson, lessonId: 'lesson-new', visibility: 'hidden' },
        {
          ...lesson,
          lessonId: 'lesson-hidden-on-purpose',
          visibility: 'hidden',
          publishedAt: PUBLISHED_AT,
        },
        lesson,
      ]),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-new', { visibility: 'hidden' }),
        textItem('item-hidden-on-purpose', {
          visibility: 'hidden',
          publishedAt: PUBLISHED_AT,
        }),
      ]),
    );

    await callAs().publishModule(moduleKey);

    const written = transactionWrites
      .filter(({ op }) => op === 'patch')
      .map(({ entity, key }) =>
        entity === 'lesson'
          ? `lesson ${(key as { lessonId: string }).lessonId}`
          : `${entity} ${(key as { contentItemId?: string }).contentItemId ?? ''}`.trim(),
      );
    expect(written).toEqual(['lesson lesson-new', 'contentItem item-new']);
  });

  it('publishModule writes nothing when the only hidden content was hidden on purpose', async () => {
    moduleGet.mockReturnValue(
      resolves({ ...module, publishedAt: PUBLISHED_AT }),
    );
    lessonQueryPrimary.mockReturnValue(
      resolves([
        { ...lesson, visibility: 'hidden', publishedAt: PUBLISHED_AT },
      ]),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-1', { visibility: 'hidden', publishedAt: PUBLISHED_AT }),
      ]),
    );

    await callAs().publishModule(moduleKey);

    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('publishLesson publishes a new item, but not one hidden after it was visible', async () => {
    lessonGet
      .mockReturnValueOnce(resolves({ ...lesson, publishedAt: PUBLISHED_AT }))
      .mockReturnValueOnce(resolves(lesson));
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-new', { visibility: 'hidden' }),
        textItem('item-hidden-on-purpose', {
          visibility: 'hidden',
          publishedAt: PUBLISHED_AT,
        }),
      ]),
    );

    await callAs().publishLesson(lessonKey);

    expect(
      transactionWrites
        .filter(({ entity, op }) => entity === 'contentItem' && op === 'patch')
        .map(({ key }) => (key as { contentItemId: string }).contentItemId),
    ).toEqual(['item-new']);
  });

  // The record you publish yourself is always published, whatever its history.
  it('publishContentItem publishes an item hidden on purpose, keeping its first publishedAt', async () => {
    contentItemGet.mockReturnValueOnce(
      resolves(
        textItem('item-1', { visibility: 'hidden', publishedAt: PUBLISHED_AT }),
      ),
    );

    await callAs().publishContentItem(itemKey('item-1'));

    expect(transactionWrites.at(-1)).toMatchObject({
      entity: 'contentItem',
      set: { visibility: 'visible' },
    });
    expect(
      (transactionWrites.at(-1) as { set: Record<string, unknown> }).set,
    ).not.toHaveProperty('publishedAt');
  });

  it('publishModule publishes the module itself when hidden on purpose, keeping its first publishedAt', async () => {
    moduleGet
      .mockReturnValueOnce(
        resolves({
          ...module,
          visibility: 'hidden',
          publishedAt: PUBLISHED_AT,
        }),
      )
      .mockReturnValueOnce(resolves(module));

    await callAs().publishModule(moduleKey);

    expect(transactionWrites[0]).toMatchObject({
      entity: 'module',
      op: 'patch',
      set: { visibility: 'visible' },
    });
    expect(
      (transactionWrites[0] as { set: Record<string, unknown> }).set,
    ).not.toHaveProperty('publishedAt');
  });

  it('hiding never touches publishedAt', async () => {
    contentItemGet.mockReturnValueOnce(
      resolves(textItem('item-1', { publishedAt: PUBLISHED_AT })),
    );

    await callAs().hideContentItem(itemKey('item-1'));

    expect(
      (transactionWrites.at(-1) as { set: Record<string, unknown> }).set,
    ).toEqual({ visibility: 'hidden' });
  });

  // A record created in a draft course is visible from the start, so it counts
  // as published then; in a published course it starts hidden and unpublished.
  it.each([
    ['draft', true],
    ['published', false],
  ] as const)(
    'records created in a %s course get publishedAt: %s',
    async (status, hasPublishedAt) => {
      setCourseStatus(status);

      await callAs().createModule({ courseId: COURSE_ID, title: 'New module' });
      await callAs().createLesson({ ...moduleKey, title: 'New lesson' });
      await callAs().createContentItemText({
        ...lessonKey,
        title: 'New text',
        body: TEXT_BODY,
      });

      for (const entity of ['module', 'lesson', 'contentItem']) {
        const values = createdRecords.findLast(
          (record) => record.entity === entity,
        )?.values;
        expect(Boolean(values?.publishedAt)).toBe(hasPublishedAt);
      }
    },
  );
});
