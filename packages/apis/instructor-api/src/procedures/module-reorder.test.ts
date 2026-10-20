/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { reorderModules } from './module.js';

const {
  transactionWrite,
  transactionGo,
  courseGet,
  courseInstructorGet,
  moduleQueryPrimary,
  modulePatch,
  modulePatchSet,
  courseCheck,
} = vi.hoisted(() => ({
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  moduleQueryPrimary: vi.fn(),
  modulePatch: vi.fn(),
  modulePatchSet: vi.fn(),
  courseCheck: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      module: {
        query: { primary: moduleQueryPrimary },
        patch: modulePatch,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({ reorderModules });
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const ARCHIVED_AT = '2024-02-01T00:00:00.000Z';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const mod = (
  id: string,
  order: number,
  extra: Record<string, unknown> = {},
) => ({
  moduleId: id,
  courseId: COURSE_ID,
  title: id,
  order,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...extra,
});

const input = (ids: string[]) => ({ courseId: COURSE_ID, moduleIds: ids });

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

// What the transaction was asked to write, in order, as the procedure built it.
let transactionItems: unknown[];
// The `where` callback each module patch was given.
let patchConditions: ((attr: any, op: any) => string)[];

const courseModules = (modules: unknown[]) =>
  moduleQueryPrimary.mockReturnValue(resolves(modules));

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
  courseModules([mod('a', 1), mod('b', 2), mod('c', 3)]);

  modulePatch.mockImplementation((key) => ({
    set: (set: unknown) => {
      modulePatchSet(key, set);
      return {
        where: (condition: (attr: any, op: any) => string) => {
          patchConditions.push(condition);
          return { commit: () => ({ key, set }) };
        },
      };
    },
  }));
  courseCheck.mockImplementation((key: unknown) => ({
    where: () => ({ commit: () => ({ entity: 'course', key }) }),
  }));
  transactionWrite.mockImplementation((build) => {
    transactionItems = build({
      course: { check: courseCheck },
      module: { patch: modulePatch },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('reorderModules', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).reorderModules(input(['a', 'b', 'c'])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('rejects an instructor who does not teach the course, without reading or writing', async () => {
    courseInstructorGet.mockReturnValue(resolves(undefined));

    await expect(
      callAs().reorderModules(input(['a', 'b', 'c'])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(moduleQueryPrimary).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('writes every order in one transaction behind the course check', async () => {
    await callAs().reorderModules(input(['c', 'a', 'b']));

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(transactionItems).toEqual([
      { entity: 'course', key: { courseId: COURSE_ID } },
      ...['c', 'a', 'b'].map((moduleId, index) => ({
        key: { courseId: COURSE_ID, moduleId },
        set: { order: index + 1 },
      })),
    ]);
  });

  it('returns the course’s modules in their new order, as written', async () => {
    moduleQueryPrimary
      .mockReturnValueOnce(resolves([mod('a', 1), mod('b', 2), mod('c', 3)]))
      .mockReturnValueOnce(resolves([mod('a', 2), mod('b', 3), mod('c', 1)]));

    const result = await callAs().reorderModules(input(['c', 'a', 'b']));

    expect(result.map(({ moduleId }) => moduleId)).toEqual(['c', 'a', 'b']);
  });

  it('conditions every module on still not being archived', async () => {
    await callAs().reorderModules(input(['b', 'a', 'c']));

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

  it('reads every page of the course’s modules', async () => {
    await callAs().reorderModules(input(['b', 'a', 'c']));

    expect(moduleQueryPrimary).toHaveBeenCalledWith({ courseId: COURSE_ID });
    expect(moduleQueryPrimary.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
  });

  // Repeating an order the course already has is harmless: no write.
  it('writes nothing when the course already has that order', async () => {
    const result = await callAs().reorderModules(input(['a', 'b', 'c']));

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result.map(({ moduleId }) => moduleId)).toEqual(['a', 'b', 'c']);
  });

  describe('the list has to be exactly the course’s modules that are not archived', () => {
    it('refuses a list that repeats a module, before reading the modules', async () => {
      await expect(
        callAs().reorderModules(input(['a', 'a', 'b'])),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(moduleQueryPrimary).not.toHaveBeenCalled();
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it.each([
      ['misses a module', ['a', 'b']],
      ['includes an id that is not in the course', ['a', 'b', 'c', 'zzz']],
      ['replaces a module with an unknown one', ['a', 'b', 'zzz']],
    ])('refuses, with CONFLICT, a list that %s', async (_, ids) => {
      await expect(callAs().reorderModules(input(ids))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('refuses a list that includes an archived module', async () => {
      courseModules([
        mod('a', 1),
        mod('b', 2),
        mod('c', 3, { archivedAt: ARCHIVED_AT }),
      ]);

      await expect(
        callAs().reorderModules(input(['a', 'b', 'c'])),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('leaves an archived module out: it keeps its order and is not written', async () => {
      courseModules([
        mod('a', 1),
        mod('b', 2),
        mod('gone', 3, { archivedAt: ARCHIVED_AT }),
      ]);

      await callAs().reorderModules(input(['b', 'a']));

      const written = transactionItems.slice(1) as {
        key: { moduleId: string };
      }[];
      expect(written.map(({ key }) => key.moduleId)).toEqual(['b', 'a']);
    });
  });

  // An archived course is read-only, so nothing is reordered.
  describe('archive rules', () => {
    it('refuses an archived course', async () => {
      courseGet.mockReturnValue(
        resolves({ courseId: COURSE_ID, status: 'archived' }),
      );

      await expect(
        callAs().reorderModules(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the course does not exist', async () => {
      courseGet.mockReturnValue(resolves(undefined));

      await expect(
        callAs().reorderModules(input(['a', 'b', 'c'])),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
        callAs().reorderModules(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
    });
  });

  describe('overlapping requests', () => {
    // A module archived or removed after the read cancels the whole reorder.
    it('reports CONFLICT, writing nothing, when a module changed after the read', async () => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, {}, { code: 'ConditionalCheckFailed' }, {}],
      });

      await expect(
        callAs().reorderModules(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('changed while you were reordering'),
      });
    });

    it('reports CONFLICT, not a server error, for a transaction conflict', async () => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, { code: 'TransactionConflict' }, {}, {}],
      });

      await expect(
        callAs().reorderModules(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
    });
  });

  // DynamoDB transactions hold at most 100 items; one is the course check.
  describe('size limit', () => {
    const courseOf = (count: number) =>
      Array.from({ length: count }, (_, i) => mod(`module-${i}`, i + 1));
    const reversed = (count: number) =>
      courseOf(count)
        .map(({ moduleId }) => moduleId)
        .reverse();

    it('reorders a course of 99 modules, which fills the transaction', async () => {
      courseModules(courseOf(99));

      await callAs().reorderModules(input(reversed(99)));

      expect(transactionItems).toHaveLength(100);
    });

    it('refuses a course of 100 modules, without starting a transaction', async () => {
      courseModules(courseOf(100));

      await expect(
        callAs().reorderModules(input(reversed(100))),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: expect.stringContaining('too many modules'),
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });
  });
});
