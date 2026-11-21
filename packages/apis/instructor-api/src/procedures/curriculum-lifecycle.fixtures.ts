/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mockCoreTable } from '@discava/common-server-utils/trpc-testing';
import { expect, vi } from 'vitest';

// What curriculum-lifecycle.*.test.ts share: the mocked tables and S3 and
// MediaConvert helpers, the fixture records and the transaction fake. A test
// file mocks `@discava/core-table` with `spies.mockModule`, which has to be
// hoisted above the procedure imports, so this module imports no procedure.

export const spies = {
  ...mockCoreTable({
    courseInstructor: ['get', 'query.primary', 'patch'],
    course: ['get'],
    module: ['get', 'create', 'query.primary', 'patch'],
    lesson: ['get', 'create', 'query.primary', 'patch'],
    contentItem: ['get', 'create', 'query.primary', 'patch', 'delete'],
    discussionPost: ['query.primary'],
    transaction: ['write'],
  }),
  transactionGo: vi.fn(),
  bestEffortDeleteContentItemVideos: vi.fn(),
  bestEffortCancelTranscodeJobs: vi.fn(),
};
export const {
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
  discussionPostQueryPrimary,
  transactionWrite,
  transactionGo,
  bestEffortDeleteContentItemVideos,
  bestEffortCancelTranscodeJobs,
} = spies;

// The smallest text body the API accepts: a document with one empty
// paragraph, as an empty editor produces.
export const TEXT_BODY = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});
export const INSTRUCTOR_SUB = 'instructor-1';
export const COURSE_ID = 'course-1';
export const MODULE_ID = 'module-1';
export const LESSON_ID = 'lesson-1';
export const ARCHIVED_AT = '2024-02-01T00:00:00.000Z';

export const timestamps = {
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const module = {
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Introduction',
  order: 1,
  visibility: 'visible' as const,
  ...timestamps,
};

export const lesson = {
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Welcome',
  kind: 'lesson' as const,
  order: 1,
  visibility: 'visible' as const,
  ...timestamps,
};

export const textItem = (
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

export const moduleKey = { courseId: COURSE_ID, moduleId: MODULE_ID };
export const lessonKey = { ...moduleKey, lessonId: LESSON_ID };
export const itemKey = (contentItemId: string) => ({
  ...lessonKey,
  contentItemId,
});

export const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

// A query whose results span more than one page: `.go()` returns only the
// first page unless asked for every page with `{ pages: 'all' }`, as
// ElectroDB's own default is a single page.
export const resolvesPaged = (firstPage: unknown[], laterPages: unknown[]) => ({
  go: vi.fn(async (options?: { pages?: number | 'all' }) => ({
    data: options?.pages === 'all' ? [...firstPage, ...laterPages] : firstPage,
  })),
});

// What a transaction was asked to write, one entry per item.
export type TransactionWrite = {
  entity: string;
  op: 'patch' | 'delete' | 'check' | 'create';
  key?: Record<string, string>;
  set?: Record<string, unknown>;
  remove?: string[];
  values?: Record<string, unknown>;
  condition?: string;
};
export let transactionWrites: TransactionWrite[];
export let createdRecords: {
  entity: string;
  values: Record<string, unknown>;
}[];

// Renders a `.where()` callback into a readable condition string.
export const renderCondition = (
  where: (attr: any, op: any) => string,
): string =>
  where(new Proxy({}, { get: (_target, name) => String(name) }), {
    eq: (name: string, value: unknown) => `${name} = ${value}`,
    exists: (name: string) => `exists(${name})`,
    notExists: (name: string) => `not exists(${name})`,
    ne: (name: string, value: unknown) => `${name} <> ${value}`,
  });

// The check that ends a draft course's permanent delete: the course must
// still be a draft when it commits.
export const draftCourseCheck = (courseId: string) => ({
  entity: 'course',
  op: 'check',
  key: { courseId },
  condition: 'status = draft',
});

// The check every write carries first: the course still exists and isn't
// archived (an archived course is read-only).
export const courseCheck = (courseId = COURSE_ID) => ({
  entity: 'course',
  op: 'check',
  key: { courseId },
  condition: 'exists(courseId) AND status <> archived',
});

// The two checks every write under a module (and lesson) carries: the
// ancestor still exists and isn't archived.
export const ancestorCheck = (entity: 'module' | 'lesson', key: object) => ({
  entity,
  op: 'check',
  key,
  condition: `exists(${entity}Id) AND not exists(archivedAt)`,
});
export const NOT_ARCHIVED = 'not exists(archivedAt)';

// Adding or restoring a record claims its parent's next order (#71): the
// parent's check becomes a patch of its lastChildOrder, behind the same
// condition and that nothing else claimed it since it was read.
export const claimed = (check: { condition: string }) => ({
  ...check,
  op: 'patch',
  set: { lastChildOrder: expect.any(Number) },
  condition: `${check.condition} AND not exists(lastChildOrder)`,
});

export const transactionEntity = (entity: string) => ({
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
      where: (where: (attr: any, op: any) => string) => ({
        commit: () => ({
          entity,
          op: 'patch',
          key,
          remove,
          condition: renderCondition(where),
        }),
      }),
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

export const setCourseStatus = (status: 'draft' | 'published' | 'archived') =>
  courseGet.mockReturnValue(resolves({ courseId: COURSE_ID, status }));

export const installDefaults = () => {
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
            // The entity's default for a lesson created without a kind.
            ...(entity === 'lesson' && { kind: 'lesson' }),
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
  discussionPostQueryPrimary.mockReturnValue(resolves([]));
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
};
