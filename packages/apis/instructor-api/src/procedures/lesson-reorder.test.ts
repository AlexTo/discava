/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { reorderLessons } from './lesson.js';

const {
  transactionWrite,
  transactionGo,
  courseGet,
  courseInstructorGet,
  moduleGet,
  lessonQueryPrimary,
  lessonPatch,
  lessonPatchSet,
  courseCheck,
  moduleCheck,
} = vi.hoisted(() => ({
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  moduleGet: vi.fn(),
  lessonQueryPrimary: vi.fn(),
  lessonPatch: vi.fn(),
  lessonPatchSet: vi.fn(),
  courseCheck: vi.fn(),
  moduleCheck: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      module: { get: moduleGet },
      lesson: {
        query: { primary: lessonQueryPrimary },
        patch: lessonPatch,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({ reorderLessons });
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const ARCHIVED_AT = '2024-02-01T00:00:00.000Z';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const lesson = (
  id: string,
  order: number,
  extra: Record<string, unknown> = {},
) => ({
  lessonId: id,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: id,
  order,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...extra,
});

const input = (ids: string[]) => ({
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonIds: ids,
});

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

// What the transaction was asked to write, in order, as the procedure built it.
let transactionItems: unknown[];
// The `where` callback each lesson patch was given.
let patchConditions: ((attr: any, op: any) => string)[];

const moduleLessons = (lessons: unknown[]) =>
  lessonQueryPrimary.mockReturnValue(resolves(lessons));

beforeEach(() => {
  vi.clearAllMocks();
  transactionItems = [];
  patchConditions = [];

  courseGet.mockReturnValue(
    resolves({ courseId: COURSE_ID, status: 'published' }),
  );
  courseInstructorGet.mockReturnValue(
    resolves({ courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB }),
  );
  moduleGet.mockReturnValue(resolves({ moduleId: MODULE_ID }));
  moduleLessons([lesson('a', 1), lesson('b', 2), lesson('c', 3)]);

  lessonPatch.mockImplementation((key) => ({
    set: (set: unknown) => {
      lessonPatchSet(key, set);
      return {
        where: (condition: (attr: any, op: any) => string) => {
          patchConditions.push(condition);
          return { commit: () => ({ key, set }) };
        },
      };
    },
  }));
  const check = (entity: string) => (key: unknown) => ({
    where: () => ({ commit: () => ({ entity, key }) }),
  });
  courseCheck.mockImplementation(check('course'));
  moduleCheck.mockImplementation(check('module'));
  transactionWrite.mockImplementation((build) => {
    transactionItems = build({
      course: { check: courseCheck },
      module: { check: moduleCheck },
      lesson: { patch: lessonPatch },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('reorderLessons', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).reorderLessons(input(['a', 'b', 'c'])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('rejects an instructor who does not teach the course, without reading or writing', async () => {
    courseInstructorGet.mockReturnValue(resolves(undefined));

    await expect(
      callAs().reorderLessons(input(['a', 'b', 'c'])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(lessonQueryPrimary).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('writes every order in one transaction behind the course and module checks', async () => {
    await callAs().reorderLessons(input(['c', 'a', 'b']));

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(transactionItems).toEqual([
      { entity: 'course', key: { courseId: COURSE_ID } },
      { entity: 'module', key: { courseId: COURSE_ID, moduleId: MODULE_ID } },
      ...['c', 'a', 'b'].map((lessonId, index) => ({
        key: { courseId: COURSE_ID, moduleId: MODULE_ID, lessonId },
        set: { order: index + 1 },
      })),
    ]);
  });

  it('returns the module’s lessons in their new order, as written', async () => {
    lessonQueryPrimary
      .mockReturnValueOnce(
        resolves([lesson('a', 1), lesson('b', 2), lesson('c', 3)]),
      )
      .mockReturnValueOnce(
        resolves([lesson('a', 2), lesson('b', 3), lesson('c', 1)]),
      );

    const result = await callAs().reorderLessons(input(['c', 'a', 'b']));

    expect(result.map(({ lessonId }) => lessonId)).toEqual(['c', 'a', 'b']);
  });

  it('conditions every lesson on still not being archived', async () => {
    await callAs().reorderLessons(input(['b', 'a', 'c']));

    expect(patchConditions).toHaveLength(3);
    for (const condition of patchConditions) {
      expect(
        condition(
          { archivedAt: 'archivedAt' },
          { notExists: (name: string) => `not exists(${name})` },
        ),
      ).toBe('not exists(archivedAt)');
    }
  });

  it('reads every page of the module’s lessons', async () => {
    await callAs().reorderLessons(input(['b', 'a', 'c']));

    expect(lessonQueryPrimary).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
    });
    expect(lessonQueryPrimary.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
  });

  // Repeating an order the module already has is harmless: no write.
  it('writes nothing when the module already has that order', async () => {
    const result = await callAs().reorderLessons(input(['a', 'b', 'c']));

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result.map(({ lessonId }) => lessonId)).toEqual(['a', 'b', 'c']);
  });

  describe('the list has to be exactly the module’s lessons that are not archived', () => {
    it('refuses a list that repeats a lesson, before reading the lessons', async () => {
      await expect(
        callAs().reorderLessons(input(['a', 'a', 'b'])),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(lessonQueryPrimary).not.toHaveBeenCalled();
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it.each([
      ['misses a lesson', ['a', 'b']],
      ['includes an id that is not in the module', ['a', 'b', 'c', 'zzz']],
      ['replaces a lesson with an unknown one', ['a', 'b', 'zzz']],
    ])('refuses, with CONFLICT, a list that %s', async (_, ids) => {
      await expect(callAs().reorderLessons(input(ids))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('refuses a list that includes an archived lesson', async () => {
      moduleLessons([
        lesson('a', 1),
        lesson('b', 2),
        lesson('c', 3, { archivedAt: ARCHIVED_AT }),
      ]);

      await expect(
        callAs().reorderLessons(input(['a', 'b', 'c'])),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('leaves an archived lesson out: it keeps its order and is not written', async () => {
      moduleLessons([
        lesson('a', 1),
        lesson('b', 2),
        lesson('gone', 3, { archivedAt: ARCHIVED_AT }),
      ]);

      await callAs().reorderLessons(input(['b', 'a']));

      const written = transactionItems.slice(2) as {
        key: { lessonId: string };
      }[];
      expect(written.map(({ key }) => key.lessonId)).toEqual(['b', 'a']);
    });
  });

  // An archived course or module is read-only, so nothing is reordered.
  describe('archive rules', () => {
    it('refuses an archived course', async () => {
      courseGet.mockReturnValue(
        resolves({ courseId: COURSE_ID, status: 'archived' }),
      );

      await expect(
        callAs().reorderLessons(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('refuses an archived module', async () => {
      moduleGet.mockReturnValue(
        resolves({ moduleId: MODULE_ID, archivedAt: ARCHIVED_AT }),
      );

      await expect(
        callAs().reorderLessons(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the module first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the module does not exist', async () => {
      moduleGet.mockReturnValue(resolves(undefined));

      await expect(
        callAs().reorderLessons(input(['a', 'b', 'c'])),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses with the precise error when the module is archived after the checks', async () => {
      let archived = false;
      moduleGet.mockImplementation(() =>
        resolves({
          moduleId: MODULE_ID,
          ...(archived && { archivedAt: ARCHIVED_AT }),
        }),
      );
      transactionGo.mockImplementation(async () => {
        archived = true;
        return {
          canceled: true,
          data: [{}, { code: 'ConditionalCheckFailed' }],
        };
      });

      await expect(
        callAs().reorderLessons(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the module first',
      });
    });

    it('refuses with the precise error when the course is archived after the checks', async () => {
      let archived = false;
      courseGet.mockImplementation(() =>
        resolves({
          courseId: COURSE_ID,
          status: archived ? 'archived' : 'published',
        }),
      );
      transactionGo.mockImplementation(async () => {
        archived = true;
        return { canceled: true, data: [{ code: 'ConditionalCheckFailed' }] };
      });

      await expect(
        callAs().reorderLessons(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
    });
  });

  describe('overlapping requests', () => {
    // A lesson archived or removed after the read cancels the whole reorder.
    it('reports CONFLICT, writing nothing, when a lesson changed after the read', async () => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, {}, {}, { code: 'ConditionalCheckFailed' }, {}],
      });

      await expect(
        callAs().reorderLessons(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('changed while you were reordering'),
      });
    });

    it('reports CONFLICT, not a server error, for a transaction conflict', async () => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, {}, { code: 'TransactionConflict' }, {}, {}],
      });

      await expect(
        callAs().reorderLessons(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
    });
  });

  // DynamoDB transactions hold at most 100 items; two are the checks.
  describe('size limit', () => {
    const moduleOf = (count: number) =>
      Array.from({ length: count }, (_, i) => lesson(`lesson-${i}`, i + 1));
    const reversed = (count: number) =>
      moduleOf(count)
        .map(({ lessonId }) => lessonId)
        .reverse();

    it('reorders a module of 98 lessons, which fills the transaction', async () => {
      moduleLessons(moduleOf(98));

      await callAs().reorderLessons(input(reversed(98)));

      expect(transactionItems).toHaveLength(100);
    });

    it('refuses a module of 99 lessons, without starting a transaction', async () => {
      moduleLessons(moduleOf(99));

      await expect(
        callAs().reorderLessons(input(reversed(99))),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: expect.stringContaining('too many lessons'),
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });
  });
});
