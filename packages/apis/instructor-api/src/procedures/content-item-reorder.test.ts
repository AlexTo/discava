/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { reorderContentItems } from './content-item-shared.js';

const {
  transactionWrite,
  transactionGo,
  courseGet,
  courseInstructorGet,
  moduleGet,
  lessonGet,
  contentItemQueryPrimary,
  contentItemPatch,
  contentItemPatchSet,
  contentItemPatchWhere,
  courseCheck,
  moduleCheck,
  lessonCheck,
} = vi.hoisted(() => ({
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  moduleGet: vi.fn(),
  lessonGet: vi.fn(),
  contentItemQueryPrimary: vi.fn(),
  contentItemPatch: vi.fn(),
  contentItemPatchSet: vi.fn(),
  contentItemPatchWhere: vi.fn(),
  courseCheck: vi.fn(),
  moduleCheck: vi.fn(),
  lessonCheck: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: { get: courseInstructorGet },
      module: { get: moduleGet },
      lesson: { get: lessonGet },
      contentItem: {
        query: { primary: contentItemQueryPrimary },
        patch: contentItemPatch,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

const router = t.router({ reorderContentItems });
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const ARCHIVED_AT = '2024-02-01T00:00:00.000Z';

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const item = (
  id: string,
  order: number,
  extra: Record<string, unknown> = {},
) => ({
  contentItemId: id,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'text' as const,
  status: 'ready' as const,
  title: id,
  body: '{}',
  order,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...extra,
});

const input = (ids: string[]) => ({
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemIds: ids,
});

const resolves = (data: unknown) => ({
  go: vi.fn().mockResolvedValue({ data }),
});

// What the transaction was asked to write, in order, as the procedure built it.
let transactionItems: unknown[];
// The `where` callback each item patch was given.
let patchConditions: ((attr: any, op: any) => string)[];

const queryAfterWrite = (items: unknown[]) =>
  contentItemQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: items }),
  });

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
  lessonGet.mockReturnValue(resolves({ lessonId: LESSON_ID }));
  queryAfterWrite([item('a', 1), item('b', 2), item('c', 3)]);

  contentItemPatch.mockImplementation((key) => ({
    set: (set: unknown) => {
      contentItemPatchSet(key, set);
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
  lessonCheck.mockImplementation(check('lesson'));
  transactionWrite.mockImplementation((build) => {
    transactionItems = build({
      course: { check: courseCheck },
      module: { check: moduleCheck },
      lesson: { check: lessonCheck },
      contentItem: { patch: contentItemPatch },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('reorderContentItems', () => {
  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).reorderContentItems(input(['a', 'b', 'c'])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('rejects an instructor who does not teach the course, without reading or writing', async () => {
    courseInstructorGet.mockReturnValue(resolves(undefined));

    await expect(
      callAs().reorderContentItems(input(['a', 'b', 'c'])),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(contentItemQueryPrimary).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('writes every order in one transaction behind the course, module and lesson checks', async () => {
    const result = await callAs().reorderContentItems(input(['c', 'a', 'b']));

    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(transactionItems).toEqual([
      { entity: 'course', key: { courseId: COURSE_ID } },
      { entity: 'module', key: { courseId: COURSE_ID, moduleId: MODULE_ID } },
      {
        entity: 'lesson',
        key: { courseId: COURSE_ID, moduleId: MODULE_ID, lessonId: LESSON_ID },
      },
      ...['c', 'a', 'b'].map((contentItemId, index) => ({
        key: {
          courseId: COURSE_ID,
          moduleId: MODULE_ID,
          lessonId: LESSON_ID,
          contentItemId,
        },
        set: { order: index + 1 },
      })),
    ]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns the lesson’s items in their new order, as written', async () => {
    contentItemQueryPrimary
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: [item('a', 1), item('b', 2), item('c', 3)],
        }),
      })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: [item('a', 2), item('b', 3), item('c', 1)],
        }),
      });

    const result = await callAs().reorderContentItems(input(['c', 'a', 'b']));

    expect(result.map(({ contentItemId }) => contentItemId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('conditions every item on still not being archived', async () => {
    await callAs().reorderContentItems(input(['b', 'a', 'c']));

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

  it('reads every page of the lesson’s items', async () => {
    await callAs().reorderContentItems(input(['b', 'a', 'c']));

    expect(
      contentItemQueryPrimary.mock.results[0].value.go,
    ).toHaveBeenCalledWith({
      pages: 'all',
    });
  });

  // Repeating an order the lesson already has is harmless: no write.
  it('writes nothing when the lesson already has that order', async () => {
    const result = await callAs().reorderContentItems(input(['a', 'b', 'c']));

    expect(transactionWrite).not.toHaveBeenCalled();
    expect(result.map(({ contentItemId }) => contentItemId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  describe('the list has to be exactly the lesson’s items that are not archived', () => {
    it('refuses a list that repeats an item, before reading anything', async () => {
      await expect(
        callAs().reorderContentItems(input(['a', 'a', 'b'])),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(contentItemQueryPrimary).not.toHaveBeenCalled();
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it.each([
      ['misses an item', ['a', 'b']],
      ['includes an id that is not in the lesson', ['a', 'b', 'c', 'zzz']],
      ['replaces an item with an unknown one', ['a', 'b', 'zzz']],
    ])('refuses, with CONFLICT, a list that %s', async (_, ids) => {
      await expect(
        callAs().reorderContentItems(input(ids)),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('refuses a list that includes an archived item', async () => {
      queryAfterWrite([
        item('a', 1),
        item('b', 2),
        item('c', 3, { archivedAt: ARCHIVED_AT }),
      ]);

      await expect(
        callAs().reorderContentItems(input(['a', 'b', 'c'])),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('leaves an archived item out: it keeps its order and is not written', async () => {
      queryAfterWrite([
        item('a', 1),
        item('b', 2),
        item('gone', 3, { archivedAt: ARCHIVED_AT }),
      ]);

      await callAs().reorderContentItems(input(['b', 'a']));

      const written = transactionItems.slice(3) as {
        key: { contentItemId: string };
      }[];
      expect(written.map(({ key }) => key.contentItemId)).toEqual(['b', 'a']);
    });
  });

  // An archived course, module or lesson is read-only, so nothing is reordered.
  describe('archive rules', () => {
    it('refuses an archived course', async () => {
      courseGet.mockReturnValue(
        resolves({ courseId: COURSE_ID, status: 'archived' }),
      );

      await expect(
        callAs().reorderContentItems(input(['c', 'a', 'b'])),
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
        callAs().reorderContentItems(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the module first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('refuses an archived lesson', async () => {
      lessonGet.mockReturnValue(
        resolves({ lessonId: LESSON_ID, archivedAt: ARCHIVED_AT }),
      );

      await expect(
        callAs().reorderContentItems(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the lesson first',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when the lesson does not exist', async () => {
      lessonGet.mockReturnValue(resolves(undefined));

      await expect(
        callAs().reorderContentItems(input(['a', 'b', 'c'])),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses with the precise error when an ancestor is archived after the checks', async () => {
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
        callAs().reorderContentItems(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course first',
      });
    });
  });

  describe('overlapping requests', () => {
    // An item archived or removed after the read cancels the whole reorder.
    it('reports CONFLICT, writing nothing, when an item changed after the read', async () => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, {}, {}, {}, { code: 'ConditionalCheckFailed' }, {}],
      });

      await expect(
        callAs().reorderContentItems(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('changed while you were reordering'),
      });
    });

    it('reports CONFLICT, not a server error, for a transaction conflict', async () => {
      transactionGo.mockResolvedValue({
        canceled: true,
        data: [{}, {}, {}, { code: 'TransactionConflict' }, {}, {}],
      });

      await expect(
        callAs().reorderContentItems(input(['c', 'a', 'b'])),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('Please retry'),
      });
    });
  });

  // DynamoDB transactions hold at most 100 items; three are the checks.
  describe('size limit', () => {
    const lessonOf = (count: number) =>
      Array.from({ length: count }, (_, i) => item(`item-${i}`, i + 1));
    const reversed = (count: number) =>
      lessonOf(count)
        .map(({ contentItemId }) => contentItemId)
        .reverse();

    it('reorders a lesson of 97 items, which fills the transaction', async () => {
      queryAfterWrite(lessonOf(97));

      await callAs().reorderContentItems(input(reversed(97)));

      expect(transactionItems).toHaveLength(100);
    });

    it('refuses a lesson of 98 items, without starting a transaction', async () => {
      queryAfterWrite(lessonOf(98));

      await expect(
        callAs().reorderContentItems(input(reversed(98))),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: expect.stringContaining('too many content items'),
      });
      expect(transactionWrite).not.toHaveBeenCalled();
    });
  });
});
