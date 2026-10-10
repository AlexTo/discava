/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { myQuizAttempts, submitQuizAttempt, viewQuiz } from './quiz.js';

// What the mocked table holds for this test; each entity's `get` reads it.
const { db, transactionGo, attemptQuery } = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  transactionGo: vi.fn(),
  attemptQuery: vi.fn(),
}));

// A transaction item as the procedure built it: the entity, the operation, its
// key or data, and its condition rendered as a string, e.g.
// "visibility = visible AND notExists(archivedAt)".
interface TransactionItem {
  entity: string;
  op: 'check' | 'update' | 'patch' | 'create';
  key?: Record<string, unknown>;
  data?: Record<string, unknown>;
  set?: Record<string, unknown>;
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
    set: (set: Record<string, unknown>) => chain({ ...item, set }),
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
    patch: (key: Record<string, unknown>) =>
      chain({ entity, op: 'patch', key }),
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
  quizAttempt: { query: { primary: attemptQuery } },
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
              'quizSummary',
              'quizAttempt',
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
  view: viewQuiz,
  submitAttempt: submitQuizAttempt,
  myAttempts: myQuizAttempts,
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
  contentItemId: 'quiz-1',
};

const prompt = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const SECRET_EXPLANATION = prompt('Fargate runs containers serverlessly');

// q1 is single choice (b is right); q2 is multiple choice (a and c are).
const quizItem = {
  ...ref,
  type: 'quiz' as const,
  status: 'ready' as const,
  title: 'Module 1 check',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  questions: [
    {
      questionId: 'q1',
      kind: 'single',
      prompt: prompt('Which service runs containers without servers?'),
      options: [
        { optionId: 'a', text: 'EC2' },
        { optionId: 'b', text: 'Fargate' },
      ],
    },
    {
      questionId: 'q2',
      kind: 'multiple',
      prompt: prompt('Which are serverless?'),
      options: [
        { optionId: 'a', text: 'Lambda' },
        { optionId: 'b', text: 'EC2' },
        { optionId: 'c', text: 'Fargate' },
      ],
    },
  ],
  answerKey: {
    q1: { correctOptionIds: ['b'], explanation: SECRET_EXPLANATION },
    q2: { correctOptionIds: ['a', 'c'] },
  },
  settings: {
    passMarkPercent: 50,
    attemptsAllowed: 3,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  quizVersion: 4,
  questionsHash: 'hash-4',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

const allCorrect = { q1: ['b'], q2: ['a', 'c'] };

const submit = (answers: Record<string, string[]>, questionsHash = 'hash-4') =>
  callAsUser().submitAttempt({ ...ref, questionsHash, answers });

const withSettings = (settings: Partial<typeof quizItem.settings>) => {
  db.contentItem = {
    ...quizItem,
    settings: { ...quizItem.settings, ...settings },
  };
};

const existingSummary = (summary: Record<string, unknown>) => {
  db.quizSummary = {
    userId: USER_SUB,
    courseId: 'course-1',
    contentItemId: 'quiz-1',
    moduleId: 'module-1',
    lessonId: 'lesson-1',
    attemptsUsed: 1,
    bestScore: 50,
    bestAttemptId: 'attempt-0',
    ...summary,
  };
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
  db.contentItem = quizItem;
  db.enrolment = {
    courseId: 'course-1',
    userId: USER_SUB,
    status: 'active',
    progressPercent: 0,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  attemptQuery.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
});

// The access rules every quiz procedure shares.
describe.each([
  ['view', () => callAsUser().view(ref)],
  ['submitAttempt', () => submit(allCorrect)],
  ['myAttempts', () => callAsUser().myAttempts(ref)],
] as const)('%s access', (name, call) => {
  it('rejects unauthenticated callers', async () => {
    const anonymous = callAnonymously();
    await expect(
      name === 'submitAttempt'
        ? anonymous.submitAttempt({
            ...ref,
            questionsHash: 'hash-4',
            answers: {},
          })
        : anonymous[name](ref),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('is FORBIDDEN without an enrolment in a published course', async () => {
    db.enrolment = null;
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactions).toHaveLength(0);
  });

  it('is FORBIDDEN with a dropped enrolment', async () => {
    db.enrolment = { ...db.enrolment, status: 'dropped' };
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('is NOT_FOUND without an enrolment in a course that isn’t published', async () => {
    db.enrolment = null;
    db.course = { ...db.course, status: 'draft' };
    await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['the quiz is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['the quiz is archived', () => (db.contentItem.archivedAt = 'x')],
    ['its lesson is hidden', () => (db.lesson.visibility = 'hidden')],
    ['its lesson is archived', () => (db.lesson.archivedAt = 'x')],
    ['its module is hidden', () => (db.module.visibility = 'hidden')],
    ['its module is archived', () => (db.module.archivedAt = 'x')],
    ['it doesn’t exist', () => (db.contentItem = null)],
    ['it isn’t a quiz', () => (db.contentItem.type = 'text')],
  ])('is NOT_FOUND when %s', async (_, change) => {
    db.contentItem = { ...quizItem };
    db.module = { ...db.module };
    db.lesson = { ...db.lesson };
    change();
    await expect(call()).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(transactions).toHaveLength(0);
  });
});

describe('view', () => {
  // Invariant: the answer key never leaks through quiz.view.
  it('returns the questions and settings without the answer key', async () => {
    const result = await callAsUser().view(ref);

    expect(result).toMatchObject({
      ...ref,
      title: 'Module 1 check',
      questions: quizItem.questions,
      settings: quizItem.settings,
      quizVersion: 4,
      questionsHash: 'hash-4',
    });
    expect(result).not.toHaveProperty('answerKey');
    expect(JSON.stringify(result)).not.toContain('correctOptionIds');
    expect(JSON.stringify(result)).not.toContain(SECRET_EXPLANATION);
  });

  it('still shows the quiz to an enrolled student once the course is archived', async () => {
    db.course = { ...db.course, status: 'archived' };
    await expect(callAsUser().view(ref)).resolves.toMatchObject(ref);
  });
});

describe('submitAttempt', () => {
  // Invariant: the first attempt counts the student once on the quiz, and
  // the whole attempt lands only while everything it depends on still holds.
  it('records a first attempt in one transaction with every check', async () => {
    const result = await submit(allCorrect);

    expect(transactions).toHaveLength(1);
    const [transaction] = transactions;
    expect(transaction.map(({ entity, op }) => `${entity}.${op}`)).toEqual([
      'course.check',
      'module.check',
      'lesson.check',
      'contentItem.update',
      'enrolment.check',
      'quizSummary.create',
      'quizAttempt.create',
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
      condition:
        'visibility = visible AND notExists(archivedAt) AND quizVersion = 4',
    });
    expect(itemOf(transaction, 'enrolment')).toMatchObject({
      key: { courseId: 'course-1', userId: USER_SUB },
      condition: 'exists(userId) AND status <> dropped',
    });
    const attemptId = result.attempt.attemptId;
    expect(itemOf(transaction, 'quizSummary').data).toMatchObject({
      userId: USER_SUB,
      courseId: 'course-1',
      contentItemId: 'quiz-1',
      moduleId: 'module-1',
      lessonId: 'lesson-1',
      attemptsUsed: 1,
      bestScore: 100,
      bestAttemptId: attemptId,
      passedAt: result.attempt.submittedAt,
    });
    // For the caller, never for a user named in the input.
    expect(itemOf(transaction, 'quizAttempt').data).toMatchObject({
      userId: USER_SUB,
      ...ref,
      attemptId,
      answers: allCorrect,
      correctQuestionIds: ['q1', 'q2'],
      scorePercent: 100,
      passed: true,
      quizVersion: 4,
      questionsHash: 'hash-4',
    });
    expect(result.summary).toEqual({
      attemptsUsed: 1,
      attemptsAllowed: 3,
      bestScore: 100,
      bestAttemptId: attemptId,
      passedAt: result.attempt.submittedAt,
    });
  });

  // Invariant: studentActivityCount counts each student once per quiz.
  it('doesn’t count the student again on a later attempt, and conditions on the attempts used', async () => {
    existingSummary({ attemptsUsed: 2 });

    await submit(allCorrect);

    const [transaction] = transactions;
    expect(itemOf(transaction, 'contentItem')).toMatchObject({
      op: 'check',
      condition:
        'visibility = visible AND notExists(archivedAt) AND quizVersion = 4',
    });
    expect(itemOf(transaction, 'contentItem')).not.toHaveProperty('add');
    expect(itemOf(transaction, 'quizSummary')).toMatchObject({
      op: 'patch',
      key: { userId: USER_SUB, courseId: 'course-1', contentItemId: 'quiz-1' },
      set: { attemptsUsed: 3 },
      condition: 'attemptsUsed = 2',
    });
  });

  describe('grading', () => {
    it.each([
      ['every option exactly right', allCorrect, ['q1', 'q2'], 100],
      [
        'a multiple choice answer missing a correct option',
        { q1: ['b'], q2: ['a'] },
        ['q1'],
        50,
      ],
      [
        'a multiple choice answer with an extra option',
        { q1: ['b'], q2: ['a', 'b', 'c'] },
        ['q1'],
        50,
      ],
      [
        'a multiple choice answer in another order',
        { q1: ['a'], q2: ['c', 'a'] },
        ['q2'],
        50,
      ],
      ['the wrong single choice option', { q1: ['a'], q2: [] }, [], 0],
      ['nothing answered', {}, [], 0],
    ])('grades %s all-or-nothing', async (_, answers, correct, score) => {
      const { attempt } = await submit(answers);
      expect(attempt.correctQuestionIds).toEqual(correct);
      expect(attempt.scorePercent).toBe(score);
    });

    it('rounds the score down and passes only at or above the pass mark', async () => {
      db.contentItem = {
        ...quizItem,
        questions: [
          ...quizItem.questions,
          { ...quizItem.questions[0], questionId: 'q3' },
        ],
        answerKey: { ...quizItem.answerKey, q3: { correctOptionIds: ['b'] } },
        settings: { ...quizItem.settings, passMarkPercent: 67 },
      };

      const { attempt } = await submit({ q1: ['b'], q2: ['a', 'c'] });
      expect(attempt.scorePercent).toBe(66);
      expect(attempt.passed).toBe(false);
    });

    // An edit to the key only leaves the student's screen unchanged, so the
    // attempt is graded against the corrected key without interrupting them.
    it('grades against the current key when only the key changed', async () => {
      db.contentItem = {
        ...quizItem,
        answerKey: { ...quizItem.answerKey, q1: { correctOptionIds: ['a'] } },
      };

      const { attempt } = await submit({ q1: ['a'], q2: ['a', 'c'] });
      expect(attempt.correctQuestionIds).toEqual(['q1', 'q2']);
    });

    it.each([
      ['an unknown question', { q9: ['a'] }],
      ['an option of another question', { q1: ['c'] }],
      ['two options for a single choice question', { q1: ['a', 'b'] }],
      ['a repeated option', { q2: ['a', 'a'] }],
    ])('is a BAD_REQUEST for %s', async (_, answers) => {
      await expect(submit(answers)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(transactions).toHaveLength(0);
    });
  });

  describe('best score', () => {
    // Invariant: retaking never lowers the best score.
    it('keeps the best score and attempt when a retake scores lower', async () => {
      existingSummary({ bestScore: 100, bestAttemptId: 'attempt-0' });

      const { summary } = await submit({ q1: ['a'] });

      expect(itemOf(transactions[0], 'quizSummary').set).toMatchObject({
        bestScore: 100,
        bestAttemptId: 'attempt-0',
      });
      expect(summary).toMatchObject({
        bestScore: 100,
        bestAttemptId: 'attempt-0',
      });
    });

    it('raises the best score when a retake scores higher', async () => {
      existingSummary({ bestScore: 50, bestAttemptId: 'attempt-0' });

      const { attempt, summary } = await submit(allCorrect);

      expect(summary).toMatchObject({
        bestScore: 100,
        bestAttemptId: attempt.attemptId,
      });
    });

    // Invariant: a recorded pass is permanent.
    it('keeps a recorded pass when a retake fails', async () => {
      existingSummary({ passedAt: '2024-02-01T00:00:00.000Z' });

      const { attempt, summary } = await submit({});

      expect(attempt.passed).toBe(false);
      expect(summary.passedAt).toBe('2024-02-01T00:00:00.000Z');
    });

    it('keeps a recorded pass after the pass mark is raised', async () => {
      existingSummary({ passedAt: '2024-02-01T00:00:00.000Z' });
      withSettings({ passMarkPercent: 100 });

      const { summary } = await submit({ q1: ['b'] });

      expect(summary.passedAt).toBe('2024-02-01T00:00:00.000Z');
    });

    it('records the first pass', async () => {
      existingSummary({});

      const { attempt, summary } = await submit(allCorrect);

      expect(summary.passedAt).toBe(attempt.submittedAt);
      expect(itemOf(transactions[0], 'quizSummary').set).toMatchObject({
        passedAt: attempt.submittedAt,
      });
    });
  });

  describe('attempt limit', () => {
    it('is PRECONDITION_FAILED once every attempt is used, writing nothing', async () => {
      existingSummary({ attemptsUsed: 3 });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'No attempts remaining',
      });
      expect(transactions).toHaveLength(0);
    });

    it('is PRECONDITION_FAILED once attemptsAllowed is lowered below the attempts used', async () => {
      existingSummary({ attemptsUsed: 2 });
      withSettings({ attemptsAllowed: 1 });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });

    it('allows any number of attempts when unlimited', async () => {
      existingSummary({ attemptsUsed: 99 });
      withSettings({ attemptsAllowed: null });

      const { summary } = await submit(allCorrect);
      expect(summary).toMatchObject({
        attemptsUsed: 100,
        attemptsAllowed: null,
      });
    });

    // Invariant: the limit holds when two submissions race. The loser's
    // summary condition fails; it re-reads, finds the last attempt used,
    // and is refused without writing.
    it('refuses the losing submission of a race for the last attempt', async () => {
      existingSummary({ attemptsUsed: 2 });
      transactionGo.mockImplementationOnce(async () => {
        // The other submission landed in the meantime.
        existingSummary({ attemptsUsed: 3 });
        return cancelledWith([
          'None',
          'None',
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
          'None',
        ]);
      });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'No attempts remaining',
      });
      expect(transactions).toHaveLength(1);
    });

    // Two first attempts racing: the loser's summary create fails, and its
    // retry counts as a later attempt, so the student is counted once.
    it('retries a lost race for the first attempt as a later attempt', async () => {
      transactionGo.mockImplementationOnce(async () => {
        existingSummary({ attemptsUsed: 1 });
        return cancelledWith([
          'None',
          'None',
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
          'None',
        ]);
      });

      const { summary } = await submit(allCorrect);

      expect(transactions).toHaveLength(2);
      expect(itemOf(transactions[0], 'contentItem').op).toBe('update');
      expect(itemOf(transactions[1], 'contentItem').op).toBe('check');
      expect(itemOf(transactions[1], 'quizSummary').condition).toBe(
        'attemptsUsed = 1',
      );
      expect(summary.attemptsUsed).toBe(2);
    });

    it('is a CONFLICT when every retry loses', async () => {
      transactionGo.mockResolvedValue(cancelledWith(['TransactionConflict']));

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(transactions).toHaveLength(3);
    });

    it('is an INTERNAL_SERVER_ERROR for any other cancellation', async () => {
      transactionGo.mockResolvedValue(cancelledWith(['ValidationError']));

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
      });
      expect(transactions).toHaveLength(1);
    });
  });

  describe('quiz or course changed', () => {
    // Invariant: a student who answered different questions doesn't lose an
    // attempt.
    it('is a CONFLICT without using an attempt when the questions changed', async () => {
      await expect(submit(allCorrect, 'hash-3')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(transactions).toHaveLength(0);
    });

    it('regrades against the new version when the quiz was saved mid-submit with the same questions', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.contentItem = {
          ...quizItem,
          quizVersion: 5,
          answerKey: { ...quizItem.answerKey, q1: { correctOptionIds: ['a'] } },
        };
        return cancelledWith([
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
        ]);
      });

      const { attempt } = await submit({ q1: ['a'] });

      expect(transactions).toHaveLength(2);
      expect(itemOf(transactions[1], 'contentItem').condition).toContain(
        'quizVersion = 5',
      );
      expect(attempt).toMatchObject({
        quizVersion: 5,
        correctQuestionIds: ['q1'],
      });
    });

    it('is a CONFLICT when the questions changed mid-submit', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.contentItem = {
          ...quizItem,
          quizVersion: 5,
          questionsHash: 'hash-5',
        };
        return cancelledWith([
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
        ]);
      });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(transactions).toHaveLength(1);
    });

    it('is NOT_FOUND when the quiz was hidden mid-submit', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.contentItem = { ...quizItem, visibility: 'hidden' };
        return cancelledWith([
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
        ]);
      });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'This quiz is no longer available',
      });
    });

    // Invariant: an archived course is read-only for students too.
    it('is PRECONDITION_FAILED in an archived course, writing nothing', async () => {
      db.course = { ...db.course, status: 'archived' };

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(transactions).toHaveLength(0);
    });

    it('is PRECONDITION_FAILED when the course was archived mid-submit', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.course = { ...db.course, status: 'archived' };
        return cancelledWith(['ConditionalCheckFailed']);
      });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      expect(transactions).toHaveLength(1);
    });

    it('is FORBIDDEN when the enrolment was dropped mid-submit', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.enrolment = { ...db.enrolment, status: 'dropped' };
        return cancelledWith([
          'None',
          'None',
          'None',
          'None',
          'ConditionalCheckFailed',
        ]);
      });

      await expect(submit(allCorrect)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('revealing answers', () => {
    // Invariant: the key only ever leaves the server as a reveal the quiz's
    // settings allow.
    it('reveals the correct options and explanations after each attempt when set', async () => {
      const { reveal } = await submit({});

      expect(reveal).toEqual({
        q1: { correctOptionIds: ['b'], explanation: SECRET_EXPLANATION },
        q2: { correctOptionIds: ['a', 'c'] },
      });
    });

    it('reveals nothing before the last attempt when set to after the final attempt', async () => {
      withSettings({ revealAnswers: 'after_final_attempt' });

      const result = await submit({});

      expect(result.reveal).toBeNull();
      expect(JSON.stringify(result)).not.toContain(SECRET_EXPLANATION);
    });

    it('reveals after the last attempt when set to after the final attempt', async () => {
      withSettings({ revealAnswers: 'after_final_attempt' });
      existingSummary({ attemptsUsed: 2 });

      const { reveal } = await submit({});

      expect(reveal).toHaveProperty('q1.correctOptionIds', ['b']);
    });

    it('never reveals while attempts are unlimited, when set to after the final attempt', async () => {
      withSettings({
        revealAnswers: 'after_final_attempt',
        attemptsAllowed: null,
      });
      existingSummary({ attemptsUsed: 50 });

      await expect(submit({})).resolves.toMatchObject({ reveal: null });
    });

    it('never reveals when set to never', async () => {
      withSettings({ revealAnswers: 'never' });
      existingSummary({ attemptsUsed: 2 });

      const result = await submit({});

      expect(result.reveal).toBeNull();
      expect(JSON.stringify(result)).not.toContain(SECRET_EXPLANATION);
      // Which questions were right is still shown.
      expect(result.attempt.correctQuestionIds).toEqual([]);
    });
  });
});

describe('myAttempts', () => {
  const storedAttempt = {
    userId: USER_SUB,
    ...ref,
    attemptId: 'attempt-0',
    answers: { q1: ['b'] },
    correctQuestionIds: ['q1'],
    scorePercent: 50,
    passed: true,
    quizVersion: 4,
    questionsHash: 'hash-4',
    submittedAt: '2024-02-01T00:00:00.000Z',
  };

  it('returns the caller’s summary and attempts, with the answers once revealed', async () => {
    existingSummary({ passedAt: '2024-02-01T00:00:00.000Z' });
    attemptQuery.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [storedAttempt] }),
    });

    const result = await callAsUser().myAttempts(ref);

    expect(attemptQuery).toHaveBeenCalledWith({
      userId: USER_SUB,
      courseId: 'course-1',
      contentItemId: 'quiz-1',
    });
    expect(result).toEqual({
      summary: {
        attemptsUsed: 1,
        attemptsAllowed: 3,
        bestScore: 50,
        bestAttemptId: 'attempt-0',
        passedAt: '2024-02-01T00:00:00.000Z',
      },
      attempts: [
        {
          attemptId: 'attempt-0',
          answers: { q1: ['b'] },
          correctQuestionIds: ['q1'],
          scorePercent: 50,
          passed: true,
          quizVersion: 4,
          questionsHash: 'hash-4',
          submittedAt: '2024-02-01T00:00:00.000Z',
        },
      ],
      reveal: {
        q1: { correctOptionIds: ['b'], explanation: SECRET_EXPLANATION },
        q2: { correctOptionIds: ['a', 'c'] },
      },
    });
  });

  it('returns no summary, attempts or reveal before the first attempt', async () => {
    await expect(callAsUser().myAttempts(ref)).resolves.toEqual({
      summary: null,
      attempts: [],
      reveal: null,
    });
  });

  it('doesn’t reveal the answers the settings hold back', async () => {
    existingSummary({});
    withSettings({ revealAnswers: 'after_final_attempt' });

    const result = await callAsUser().myAttempts(ref);

    expect(result.reveal).toBeNull();
    expect(JSON.stringify(result)).not.toContain(SECRET_EXPLANATION);
  });
});
