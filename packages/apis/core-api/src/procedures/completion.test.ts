/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { completeContentItem, myItemCompletions } from './completion.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const { db, transactionGo, completionQuery } = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  transactionGo: vi.fn(),
  completionQuery: vi.fn(),
}));

// A transaction item as the procedure built it, with its condition rendered
// as a string, e.g. "visibility = visible AND notExists(archivedAt)".
interface TransactionItem {
  entity: string;
  op: 'check' | 'update' | 'create';
  key?: Record<string, unknown>;
  data?: Record<string, unknown>;
  add?: Record<string, unknown>;
  condition?: string;
}

const attr = new Proxy({}, { get: (_, name) => name });
const ops = {
  eq: (name: string, value: unknown) => `${name} = ${value}`,
  ne: (name: string, value: unknown) => `${name} <> ${value}`,
  exists: (name: string) => `exists(${name})`,
  notExists: (name: string) => `notExists(${name})`,
};

const transactionEntity = (entity: string) => {
  const chain = (item: TransactionItem) => ({
    add: (add: Record<string, unknown>) => chain({ ...item, add }),
    where: (build: (a: unknown, o: typeof ops) => string) =>
      chain({ ...item, condition: build(attr, ops) }),
    commit: () => item,
  });
  return {
    check: (key: Record<string, unknown>) =>
      chain({ entity, op: 'check', key }),
    update: (key: Record<string, unknown>) =>
      chain({ entity, op: 'update', key }),
    create: (data: Record<string, unknown>) =>
      chain({ entity, op: 'create', data }),
  };
};

const stored = (name: string) => ({
  get: vi.fn(() => ({
    go: vi.fn(async () => ({ data: db[name] ?? null })),
  })),
});

const entities = {
  course: stored('course'),
  module: stored('module'),
  lesson: stored('lesson'),
  contentItem: stored('contentItem'),
  enrolment: stored('enrolment'),
  quizSummary: stored('quizSummary'),
  itemCompletion: {
    ...stored('itemCompletion'),
    query: { primary: completionQuery },
  },
};

// Every transaction written, in order, as its list of items.
const transactions: TransactionItem[][] = [];

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities,
    transaction: {
      write: (build: (e: unknown) => TransactionItem[]) => {
        const items = build(
          Object.fromEntries(
            [
              'course',
              'module',
              'lesson',
              'contentItem',
              'enrolment',
              'itemCompletion',
            ].map((name) => [name, transactionEntity(name)]),
          ),
        );
        transactions.push(items);
        return { go: transactionGo };
      },
    },
  })),
}));

const router = t.router({
  complete: completeContentItem,
  myItemCompletions,
});
const caller = t.createCallerFactory(router);

const USER_SUB = 'student-1';

const callAsUser = () =>
  caller({
    event: {
      requestContext: { authorizer: { claims: { sub: USER_SUB } } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const callAnonymously = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'item-1',
};

const complete = () => callAsUser().complete(ref);

const quizSettings = {
  passMarkPercent: 50,
  attemptsAllowed: 3,
  shuffleOptions: false,
  revealAnswers: 'after_each_attempt',
};

const asQuiz = () => {
  db.contentItem = {
    ...db.contentItem,
    type: 'quiz',
    settings: quizSettings,
    quizVersion: 4,
  };
};

const existingSummary = (summary: Record<string, unknown>) => {
  db.quizSummary = {
    userId: USER_SUB,
    courseId: 'course-1',
    contentItemId: 'item-1',
    attemptsUsed: 1,
    bestScore: 0,
    bestAttemptId: 'attempt-1',
    ...summary,
  };
};

const existingCompletion = {
  userId: USER_SUB,
  ...ref,
  completedAt: '2024-01-03T00:00:00.000Z',
  createdAt: '2024-01-03T00:00:00.000Z',
};

const cancelledWith = (codes: string[]) => ({
  canceled: true,
  data: codes.map((code) => ({ code })),
});

const itemOf = (transaction: TransactionItem[], entity: string) =>
  transaction.find((item) => item.entity === entity)!;

beforeEach(() => {
  vi.clearAllMocks();
  transactions.length = 0;
  for (const key of Object.keys(db)) {
    delete db[key];
  }
  db.course = { courseId: 'course-1', title: 'AWS', status: 'published' };
  db.module = { ...ref, visibility: 'visible' };
  db.lesson = { ...ref, visibility: 'visible' };
  db.contentItem = {
    ...ref,
    type: 'text',
    visibility: 'visible',
    studentActivityCount: 0,
  };
  db.enrolment = {
    courseId: 'course-1',
    userId: USER_SUB,
    status: 'active',
    progressPercent: 0,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
});

describe('complete', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(callAnonymously().complete(ref)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(transactions).toHaveLength(0);
  });

  // Invariant: a completion only lands while the course is published, the
  // item and its ancestors are shown, and the student is enrolled; and
  // studentActivityCount counts the student in the same transaction.
  it('records a text item’s completion in one transaction with every check', async () => {
    const result = await complete();

    expect(transactions).toHaveLength(1);
    const [transaction] = transactions;
    expect(transaction.map(({ entity, op }) => `${entity}.${op}`)).toEqual([
      'course.check',
      'module.check',
      'lesson.check',
      'contentItem.update',
      'enrolment.check',
      'itemCompletion.create',
    ]);
    expect(itemOf(transaction, 'course').condition).toBe('status = published');
    expect(itemOf(transaction, 'module').condition).toBe(
      'visibility = visible AND notExists(archivedAt)',
    );
    expect(itemOf(transaction, 'lesson').condition).toBe(
      'visibility = visible AND notExists(archivedAt)',
    );
    expect(itemOf(transaction, 'contentItem')).toMatchObject({
      key: ref,
      add: { studentActivityCount: 1 },
      condition: 'visibility = visible AND notExists(archivedAt)',
    });
    expect(itemOf(transaction, 'enrolment')).toMatchObject({
      key: { courseId: 'course-1', userId: USER_SUB },
      condition: 'exists(userId) AND status <> dropped',
    });
    // For the caller, never for a user named in the input.
    expect(itemOf(transaction, 'itemCompletion').data).toMatchObject({
      userId: USER_SUB,
      ...ref,
      completedAt: result.completedAt,
    });
    expect(result).toEqual({ ...ref, completedAt: expect.any(String) });
  });

  it('completes a video the same way', async () => {
    db.contentItem = { ...db.contentItem, type: 'video' };

    await complete();

    expect(itemOf(transactions[0], 'contentItem').add).toEqual({
      studentActivityCount: 1,
    });
  });

  // Invariant: at most one completion per student and item, counted once.
  it('returns the existing completion without writing anything', async () => {
    db.itemCompletion = existingCompletion;

    await expect(complete()).resolves.toEqual({
      ...ref,
      completedAt: '2024-01-03T00:00:00.000Z',
    });
    expect(transactions).toHaveLength(0);
  });

  it('returns the completion that landed first when two race, counting the student once', async () => {
    transactionGo.mockImplementationOnce(async () => {
      db.itemCompletion = existingCompletion;
      return cancelledWith([
        'None',
        'None',
        'None',
        'None',
        'None',
        'ConditionalCheckFailed',
      ]);
    });

    await expect(complete()).resolves.toMatchObject({
      completedAt: '2024-01-03T00:00:00.000Z',
    });
    expect(transactions).toHaveLength(1);
  });

  it('gives the precise error when something changed mid-request', async () => {
    transactionGo.mockImplementationOnce(async () => {
      db.contentItem = { ...db.contentItem, visibility: 'hidden' };
      return cancelledWith(['None', 'None', 'None', 'ConditionalCheckFailed']);
    });

    await expect(complete()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This item is no longer available',
    });
  });

  it('is a CONFLICT after losing every retry', async () => {
    transactionGo.mockResolvedValue(cancelledWith(['TransactionConflict']));

    await expect(complete()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transactions).toHaveLength(3);
  });

  it('is an INTERNAL_SERVER_ERROR for any other cancellation', async () => {
    transactionGo.mockResolvedValue(cancelledWith(['ValidationError']));

    await expect(complete()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  describe('refuses', () => {
    it('a student who isn’t enrolled: FORBIDDEN', async () => {
      delete db.enrolment;

      await expect(complete()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('a dropped enrolment: FORBIDDEN', async () => {
      db.enrolment = { ...db.enrolment, status: 'dropped' };

      await expect(complete()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('a course that doesn’t exist: NOT_FOUND', async () => {
      delete db.course;

      await expect(complete()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it.each([
      ['item is hidden', 'contentItem', { visibility: 'hidden' }],
      ['item is archived', 'contentItem', { archivedAt: '2024-01-05' }],
      ['lesson is hidden', 'lesson', { visibility: 'hidden' }],
      ['module is archived', 'module', { archivedAt: '2024-01-05' }],
    ])('an item whose %s: NOT_FOUND', async (_, entity, change) => {
      db[entity] = { ...db[entity], ...change };

      await expect(complete()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'This item is no longer available',
      });
      expect(transactions).toHaveLength(0);
    });

    it('a missing item: NOT_FOUND', async () => {
      delete db.contentItem;

      await expect(complete()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('anything in an archived course: PRECONDITION_FAILED', async () => {
      db.course = { ...db.course, status: 'archived' };

      await expect(complete()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(transactions).toHaveLength(0);
    });
  });

  describe('a quiz', () => {
    beforeEach(asQuiz);

    it('isn’t complete before an attempt: PRECONDITION_FAILED', async () => {
      await expect(complete()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Pass the quiz, or use all its attempts, to complete it',
      });
    });

    it('isn’t complete while failed with attempts left', async () => {
      existingSummary({ attemptsUsed: 2 });

      await expect(complete()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });

    // An attempt limit lowered below what the student has already used: no
    // submit could ever record the completion.
    it('is complete once no attempts remain, without counting the student again', async () => {
      existingSummary({ attemptsUsed: 3 });

      await complete();

      const [transaction] = transactions;
      expect(itemOf(transaction, 'contentItem')).toMatchObject({
        op: 'check',
        condition:
          'visibility = visible AND notExists(archivedAt) AND quizVersion = 4',
      });
      expect(itemOf(transaction, 'itemCompletion').op).toBe('create');
    });

    it('is complete once passed', async () => {
      existingSummary({
        attemptsUsed: 1,
        bestScore: 100,
        passedAt: '2024-01-04T00:00:00.000Z',
      });

      await expect(complete()).resolves.toMatchObject(ref);
    });
  });
});

describe('myItemCompletions', () => {
  it('returns every completion the caller has in the course', async () => {
    completionQuery.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [existingCompletion] }),
    });

    const result = await callAsUser().myItemCompletions({
      courseId: 'course-1',
    });

    expect(completionQuery).toHaveBeenCalledWith({
      userId: USER_SUB,
      courseId: 'course-1',
    });
    // Every page, not just the first.
    expect(completionQuery.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
    expect(result).toEqual({
      items: [{ ...ref, completedAt: '2024-01-03T00:00:00.000Z' }],
    });
  });

  it('requires an enrolment', async () => {
    delete db.enrolment;

    await expect(
      callAsUser().myItemCompletions({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(completionQuery).not.toHaveBeenCalled();
  });

  it('is NOT_FOUND for a course that doesn’t exist', async () => {
    delete db.course;

    await expect(
      callAsUser().myItemCompletions({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().myItemCompletions({ courseId: 'course-1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
