/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../init.js';
import { restoreContentItem } from './content-item-shared.js';
import {
  ARCHIVED_AT,
  ancestorCheck,
  COURSE_ID,
  claimed,
  contentItemGet,
  contentItemPatch,
  contentItemQueryPrimary,
  courseCheck,
  INSTRUCTOR_SUB,
  installDefaults,
  itemKey,
  lesson,
  lessonGet,
  lessonKey,
  lessonPatch,
  lessonQueryPrimary,
  module,
  moduleGet,
  moduleKey,
  modulePatch,
  moduleQueryPrimary,
  resolves,
  textItem,
  transactionWrites,
} from './curriculum-lifecycle.fixtures.js';
import { restoreLesson } from './lesson.js';
import { restoreModule } from './module.js';

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
  restoreContentItem,
  restoreLesson,
  restoreModule,
});

const callAs = () =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups: ['instructor'] });

beforeEach(installDefaults);

describe('restore', () => {
  it('restores an archived module by removing archivedAt', async () => {
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));
    moduleGet
      .mockReturnValueOnce(resolves({ ...module, archivedAt: ARCHIVED_AT }))
      .mockReturnValueOnce(resolves(module));

    const result = await callAs().restoreModule(moduleKey);

    expect(transactionWrites).toEqual([
      claimed(courseCheck()),
      {
        entity: 'module',
        op: 'patch',
        key: moduleKey,
        set: { order: expect.any(Number) },
        remove: ['archivedAt'],
      },
    ]);
    expect(result.archivedAt).toBeUndefined();
  });

  it('writes nothing when the module is not archived', async () => {
    await callAs().restoreModule(moduleKey);

    expect(modulePatch).not.toHaveBeenCalled();
  });

  // Invariant: a record can only come back once its ancestors have, since
  // an archived ancestor would still hide it from students.
  it('refuses to restore a lesson under an archived module', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    moduleGet.mockReturnValue(resolves({ ...module, archivedAt: ARCHIVED_AT }));

    await expect(callAs().restoreLesson(lessonKey)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the module first',
    });
    expect(lessonPatch).not.toHaveBeenCalled();
  });

  it('restores a lesson under an active module', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));

    await callAs().restoreLesson(lessonKey);

    expect(transactionWrites).toEqual([
      courseCheck(),
      claimed(ancestorCheck('module', moduleKey)),
      {
        entity: 'lesson',
        op: 'patch',
        key: lessonKey,
        set: { order: expect.any(Number) },
        remove: ['archivedAt'],
      },
    ]);
  });

  it.each([
    ['module', 'Restore the module first'],
    ['lesson', 'Restore the lesson first'],
  ] as const)(
    'refuses to restore a content item under an archived %s',
    async (ancestor, message) => {
      contentItemGet.mockReturnValue(
        resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
      );
      if (ancestor === 'module') {
        moduleGet.mockReturnValue(
          resolves({ ...module, archivedAt: ARCHIVED_AT }),
        );
      } else {
        lessonGet.mockReturnValue(
          resolves({ ...lesson, archivedAt: ARCHIVED_AT }),
        );
      }

      await expect(
        callAs().restoreContentItem(itemKey('item-1')),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message });
      expect(contentItemPatch).not.toHaveBeenCalled();
    },
  );

  it('restores a content item whose lesson and module are active', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { archivedAt: ARCHIVED_AT })),
    );

    await callAs().restoreContentItem(itemKey('item-1'));

    expect(transactionWrites).toEqual([
      courseCheck(),
      ancestorCheck('module', moduleKey),
      claimed(ancestorCheck('lesson', lessonKey)),
      {
        entity: 'contentItem',
        op: 'patch',
        key: itemKey('item-1'),
        set: { order: expect.any(Number) },
        remove: ['archivedAt'],
      },
    ]);
  });
});

// A restored record goes to the end of its parent: one past the highest
// `order` among all its siblings, archived ones included, so it sorts last and
// never collides with an archived sibling restored later.
describe('restore puts the record at the end of its parent', () => {
  const restoredOrder = () =>
    (
      transactionWrites.find(
        ({ op, set }) => op === 'patch' && set?.order !== undefined,
      ) as unknown as { set: { order: number } }
    ).set.order;

  it('restoreModule: after every module in the course, archived ones included', async () => {
    moduleGet.mockReturnValue(
      resolves({ ...module, order: 1, archivedAt: ARCHIVED_AT }),
    );
    moduleQueryPrimary.mockReturnValue(
      resolves([
        { ...module, order: 1, archivedAt: ARCHIVED_AT },
        { ...module, moduleId: 'm2', order: 2 },
        { ...module, moduleId: 'm3', order: 5, archivedAt: ARCHIVED_AT },
      ]),
    );

    await callAs().restoreModule(moduleKey);

    expect(restoredOrder()).toBe(6);
    expect(moduleQueryPrimary.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
  });

  it('restoreLesson: after every lesson in its module', async () => {
    lessonGet.mockReturnValue(
      resolves({ ...lesson, order: 1, archivedAt: ARCHIVED_AT }),
    );
    lessonQueryPrimary.mockReturnValue(
      resolves([
        { ...lesson, order: 1, archivedAt: ARCHIVED_AT },
        { ...lesson, lessonId: 'l2', order: 3 },
      ]),
    );

    await callAs().restoreLesson(lessonKey);

    expect(restoredOrder()).toBe(4);
    expect(lessonQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: moduleKey.moduleId,
    });
  });

  it('restoreContentItem: after every item in its lesson, even when it had the highest order', async () => {
    contentItemGet.mockReturnValue(
      resolves(textItem('item-1', { order: 9, archivedAt: ARCHIVED_AT })),
    );
    contentItemQueryPrimary.mockReturnValue(
      resolves([
        textItem('item-1', { order: 9, archivedAt: ARCHIVED_AT }),
        textItem('item-2', { order: 2 }),
      ]),
    );

    await callAs().restoreContentItem(itemKey('item-1'));

    expect(restoredOrder()).toBe(10);
    expect(
      contentItemQueryPrimary.mock.results[0].value.go,
    ).toHaveBeenCalledWith({ pages: 'all' });
  });
});
