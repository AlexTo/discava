/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { bestEffortRetirePreviousVersions } from '../lib/s3-client.js';
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

// The smallest text body the API accepts: a document with one empty
// paragraph, as an empty editor produces.
const TEXT_BODY = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});
const {
  courseInstructorGet,
  courseInstructorQueryPrimary,
  courseInstructorPatch,
  courseGet,
  moduleGet,
  moduleCreate,
  moduleQueryPrimary,
  modulePatch,
  lessonGet,
  lessonCreate,
  lessonQueryPrimary,
  lessonPatch,
  contentItemGet,
  contentItemCreate,
  contentItemQueryPrimary,
  contentItemPatch,
  contentItemDelete,
  transactionWrite,
  transactionGo,
  bestEffortDeleteContentItemVideos,
  bestEffortCancelTranscodeJobs,
} = vi.hoisted(() => ({
  courseInstructorGet: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseInstructorPatch: vi.fn(),
  courseGet: vi.fn(),
  moduleGet: vi.fn(),
  moduleCreate: vi.fn(),
  moduleQueryPrimary: vi.fn(),
  modulePatch: vi.fn(),
  lessonGet: vi.fn(),
  lessonCreate: vi.fn(),
  lessonQueryPrimary: vi.fn(),
  lessonPatch: vi.fn(),
  contentItemGet: vi.fn(),
  contentItemCreate: vi.fn(),
  contentItemQueryPrimary: vi.fn(),
  contentItemPatch: vi.fn(),
  contentItemDelete: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  bestEffortDeleteContentItemVideos: vi.fn(),
  bestEffortCancelTranscodeJobs: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      courseInstructor: {
        get: courseInstructorGet,
        query: { primary: courseInstructorQueryPrimary },
        patch: courseInstructorPatch,
      },
      course: { get: courseGet },
      module: {
        get: moduleGet,
        create: moduleCreate,
        query: { primary: moduleQueryPrimary },
        patch: modulePatch,
      },
      lesson: {
        get: lessonGet,
        create: lessonCreate,
        query: { primary: lessonQueryPrimary },
        patch: lessonPatch,
      },
      contentItem: {
        get: contentItemGet,
        create: contentItemCreate,
        query: { primary: contentItemQueryPrimary },
        patch: contentItemPatch,
        delete: contentItemDelete,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

vi.mock('../lib/s3-client.js', () => ({
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions: vi.fn(async () => {}),
}));
vi.mock('../lib/mediaconvert-client.js', () => ({
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({
  createModule,
  updateModule,
  updateLesson,
  updateContentItemText,
  deleteModule,
  publishModule,
  hideModule,
  restoreModule,
  deleteModulePermanently,
  createLesson,
  deleteLesson,
  publishLesson,
  hideLesson,
  restoreLesson,
  deleteLessonPermanently,
  createContentItemText,
  deleteContentItem,
  publishContentItem,
  hideContentItem,
  restoreContentItem,
  deleteContentItemPermanently,
});
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const ARCHIVED_AT = '2024-02-01T00:00:00.000Z';

const callAs = () =>
  caller({
    event: {
      requestContext: {
        authorizer: {
          claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': ['instructor'] },
        },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const timestamps = {
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const module = {
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Introduction',
  order: 1,
  visibility: 'visible' as const,
  ...timestamps,
};

const lesson = {
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Welcome',
  order: 1,
  visibility: 'visible' as const,
  ...timestamps,
};

const textItem = (
  contentItemId: string,
  overrides: Record<string, unknown> = {},
) => ({
  contentItemId,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'text' as const,
  status: 'ready' as const,
  title: contentItemId,
  body: TEXT_BODY,
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  ...timestamps,
  ...overrides,
});

const moduleKey = { courseId: COURSE_ID, moduleId: MODULE_ID };
const lessonKey = { ...moduleKey, lessonId: LESSON_ID };
const itemKey = (contentItemId: string) => ({ ...lessonKey, contentItemId });

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

// A query whose results span more than one page: `.go()` returns only the
// first page unless asked for every page with `{ pages: 'all' }`, as
// ElectroDB's own default is a single page.
const resolvesPaged = (firstPage: unknown[], laterPages: unknown[]) => ({
  go: vi.fn(async (options?: { pages?: number | 'all' }) => ({
    data: options?.pages === 'all' ? [...firstPage, ...laterPages] : firstPage,
  })),
});

// patch(key).set(values) / .remove(attributes), then .go(); returns `data`.
const patchChain = (data: unknown) => {
  const chain = {
    set: vi.fn(() => chain),
    remove: vi.fn(() => chain),
    where: vi.fn(() => chain),
    go: vi.fn().mockResolvedValue({ data }),
  };
  return chain;
};

// What a transaction was asked to write, one entry per item.
type TransactionWrite = {
  entity: string;
  op: 'patch' | 'delete' | 'check' | 'create';
  key?: Record<string, string>;
  set?: Record<string, unknown>;
  remove?: string[];
  values?: Record<string, unknown>;
  condition?: string;
};
let transactionWrites: TransactionWrite[];
let createdRecords: { entity: string; values: Record<string, unknown> }[];

// Renders a `.where()` callback into a readable condition string.
const renderCondition = (where: (attr: any, op: any) => string): string =>
  where(new Proxy({}, { get: (_target, name) => String(name) }), {
    eq: (name: string, value: unknown) => `${name} = ${value}`,
    exists: (name: string) => `exists(${name})`,
    notExists: (name: string) => `not exists(${name})`,
    ne: (name: string, value: unknown) => `${name} <> ${value}`,
  });

// The check that ends a draft course's permanent delete: the course must
// still be a draft when it commits.
const draftCourseCheck = (courseId: string) => ({
  entity: 'course',
  op: 'check',
  key: { courseId },
  condition: 'status = draft',
});

// The check every write carries first: the course still exists and isn't
// archived (an archived course is read-only).
const courseCheck = (courseId = COURSE_ID) => ({
  entity: 'course',
  op: 'check',
  key: { courseId },
  condition: 'exists(courseId) AND status <> archived',
});

// The two checks every write under a module (and lesson) carries: the
// ancestor still exists and isn't archived.
const ancestorCheck = (entity: 'module' | 'lesson', key: object) => ({
  entity,
  op: 'check',
  key,
  condition: `exists(${entity}Id) AND not exists(archivedAt)`,
});
const NOT_ARCHIVED = 'not exists(archivedAt)';

// Adding or restoring a record claims its parent's next order (#71): the
// parent's check becomes a patch of its lastChildOrder, behind the same
// condition and that nothing else claimed it since it was read.
const claimed = (check: { condition: string }) => ({
  ...check,
  op: 'patch',
  set: { lastChildOrder: expect.any(Number) },
  condition: `${check.condition} AND not exists(lastChildOrder)`,
});

const transactionEntity = (entity: string) => ({
  patch: (key: Record<string, string>) => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: (attr: any, op: any) => string) => ({
        commit: () => ({
          entity,
          op: 'patch',
          key,
          set,
          condition: renderCondition(where),
        }),
      }),
      commit: () => ({ entity, op: 'patch', key, set }),
      remove: (remove: string[]) => ({
        commit: () => ({ entity, op: 'patch', key, set, remove }),
      }),
    }),
    remove: (remove: string[]) => ({
      commit: () => ({ entity, op: 'patch', key, remove }),
    }),
  }),
  check: (key: Record<string, string>) => ({
    where: (where: (attr: any, op: any) => string) => ({
      commit: () => ({
        entity,
        op: 'check',
        key,
        condition: renderCondition(where),
      }),
    }),
  }),
  create: (values: Record<string, unknown>) => ({
    commit: () => {
      // A created record can be read back after the transaction.
      createdRecords.push({ entity, values });
      return { entity, op: 'create', values };
    },
  }),
  delete: (key: Record<string, string>) => ({
    where: (where: (attr: any, op: any) => string) => ({
      commit: () => ({
        entity,
        op: 'delete',
        key,
        condition: renderCondition(where),
      }),
    }),
    commit: () => ({ entity, op: 'delete', key }),
  }),
});

const setCourseStatus = (status: 'draft' | 'published' | 'archived') =>
  courseGet.mockReturnValue(resolves({ courseId: COURSE_ID, status }));

beforeEach(() => {
  vi.clearAllMocks();

  courseInstructorGet.mockReturnValue(
    resolves({ courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB }),
  );
  // Adding or restoring a module updates the course (claiming its next
  // order), so its instructors' copy of updatedAt is refreshed.
  courseInstructorQueryPrimary.mockReturnValue(
    resolves([{ courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB }]),
  );
  courseInstructorPatch.mockReturnValue({ set: () => resolves({}) });
  setCourseStatus('draft');
  createdRecords = [];
  // Records created in a transaction are read back with get afterwards.
  const createdOr = (entity: string, fallback: object) => {
    const created = createdRecords.findLast((r) => r.entity === entity);
    return resolves(
      created
        ? {
            status: 'ready',
            studentActivityCount: 0,
            ...timestamps,
            ...created.values,
          }
        : fallback,
    );
  };
  moduleGet.mockReturnValue(resolves(module));
  lessonGet.mockImplementation(() => createdOr('lesson', lesson));
  contentItemGet.mockImplementation(() =>
    createdOr('contentItem', textItem('item-1')),
  );
  moduleQueryPrimary.mockReturnValue(resolves([]));
  lessonQueryPrimary.mockReturnValue(resolves([]));
  contentItemQueryPrimary.mockReturnValue(resolves([]));
  moduleCreate.mockImplementation((values) =>
    resolves({ ...timestamps, ...values }),
  );
  lessonCreate.mockImplementation((values) =>
    resolves({ ...timestamps, ...values }),
  );
  contentItemCreate.mockImplementation((values) =>
    resolves({
      status: 'ready',
      studentActivityCount: 0,
      ...timestamps,
      ...values,
    }),
  );
  transactionWrite.mockImplementation((build) => {
    transactionWrites = build({
      course: transactionEntity('course'),
      module: transactionEntity('module'),
      lesson: transactionEntity('lesson'),
      contentItem: transactionEntity('contentItem'),
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  bestEffortDeleteContentItemVideos.mockResolvedValue(undefined);
  bestEffortCancelTranscodeJobs.mockResolvedValue(undefined);
});

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
    expect(result).toEqual(lesson);
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
    const where = vi.fn(() => ({
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

  it('a permanent delete removes descendants on every page', async () => {
    lessonGet.mockReturnValue(resolves({ ...lesson, archivedAt: ARCHIVED_AT }));
    contentItemQueryPrimary.mockReturnValue(
      resolvesPaged([textItem('item-1')], [textItem('item-on-page-2')]),
    );

    await callAs().deleteLessonPermanently(lessonKey);

    expect(
      transactionWrites
        .filter(({ entity }) => entity === 'contentItem')
        .map(({ key }) => key.contentItemId),
    ).toEqual(['item-1', 'item-on-page-2']);
  });
});

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

      await expect(callAs()[procedure](key())).rejects.toMatchObject({
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

      await expect(callAs()[procedure](key())).rejects.toMatchObject({
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
        [procedure](key())
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

      await expect(callAs()[procedure](key())).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('was published'),
      });
    },
  );
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

  // The module, a check on the items' (unpublished) lesson, and 98 items.
  // The transaction also carries the check on the course.
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
        .map(({ key }) => key.lessonId),
    ).toEqual([LESSON_ID, 'lesson-page-2']);
  });
});

describe('100-record boundary', () => {
  const items = (count: number, overrides: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, index) =>
      textItem(`item-${index}`, overrides),
    );

  // Exactly 100 records still fits in one transaction.
  // The transaction also carries the module's check, so a hidden lesson
  // fits 98 hidden items.
  // The transaction also carries the checks on the course and the module.
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
    // [module check, lesson check, item patch]: the item's condition failed.
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

  // The transaction is [module check, lesson patch or check, item patch];
  // the module is visible, so it's only checked.
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

// A restored record goes to the end of its parent: one past the highest
// `order` among all its siblings, archived ones included, so it sorts last and
// never collides with an archived sibling restored later.
describe('restore puts the record at the end of its parent', () => {
  const restoredOrder = () =>
    (
      transactionWrites.find(
        ({ op, set }) => op === 'patch' && set?.order !== undefined,
      ) as { set: { order: number } }
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
