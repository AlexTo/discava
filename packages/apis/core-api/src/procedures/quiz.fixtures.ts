/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'vitest';

// What quiz*.test.ts share: the mocked tables, fixture records and
// default mock behaviour. A test file takes its spies from `spies`, which has to
// be hoisted above the procedure imports, so this module imports no procedure.

export const spies = {
  db: {} as Record<string, any>,
  transactionGo: vi.fn(),
  attemptQuery: vi.fn(),
};
export const { db, transactionGo, attemptQuery } = spies;

// A transaction item as the procedure built it: the entity, the operation, its
// key or data, and its condition rendered as a string, e.g.
// "visibility = visible AND notExists(archivedAt)".
export interface TransactionItem {
  entity: string;
  op: 'check' | 'update' | 'patch' | 'create';
  key?: Record<string, unknown>;
  data?: Record<string, unknown>;
  set?: Record<string, unknown>;
  add?: Record<string, unknown>;
  condition?: string;
}

export const attr = new Proxy({}, { get: (_, name) => name });

export const ops = {
  eq: (name: string, value: unknown) => `${name} = ${value}`,
  ne: (name: string, value: unknown) => `${name} <> ${value}`,
  lte: (name: string, value: unknown) => `${name} <= ${value}`,
  exists: (name: string) => `exists(${name})`,
  notExists: (name: string) => `notExists(${name})`,
};

export const transactionEntity = (entity: string) => {
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

export const stored = (name: string) => ({
  get: vi.fn(() => ({
    go: vi.fn(async () => ({ data: db[name] ?? null })),
  })),
});

export const entities = {
  course: stored('course'),
  module: stored('module'),
  lesson: stored('lesson'),
  contentItem: stored('contentItem'),
  enrolment: stored('enrolment'),
  quizSummary: stored('quizSummary'),
  itemCompletion: stored('itemCompletion'),
  quizAttempt: { query: { primary: attemptQuery } },
};

// Every transaction written, in order, as its list of items.
export const transactions: TransactionItem[][] = [];

export const USER_SUB = 'student-1';

export const ref = {
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'quiz-1',
};

export const prompt = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

export const SECRET_EXPLANATION = prompt(
  'Fargate runs containers serverlessly',
);

// q1 is single choice (b is right); q2 is multiple choice (a and c are).
export const quizItem = {
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

export const allCorrect = { q1: ['b'], q2: ['a', 'c'] };

export const withSettings = (settings: Partial<typeof quizItem.settings>) => {
  db.contentItem = {
    ...quizItem,
    settings: { ...quizItem.settings, ...settings },
  };
};

export const existingSummary = (summary: Record<string, unknown>) => {
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

export const cancelledWith = (codes: string[]) => ({
  canceled: true,
  data: codes.map((code) => ({ code })),
});

export const itemOf = (transaction: TransactionItem[], entity: string) =>
  transaction.find((item) => item.entity === entity)!;

export const installDefaults = () => {
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
    go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
  });
};
