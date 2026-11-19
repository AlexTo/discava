/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  allCorrect,
  attemptQuery,
  db,
  entities,
  existingSummary,
  installDefaults,
  quizItem,
  ref,
  SECRET_EXPLANATION,
  TransactionItem,
  transactionEntity,
  transactions,
  USER_SUB,
  withSettings,
} from './quiz.fixtures.js';
import { myQuizAttempts, submitQuizAttempt, viewQuiz } from './quiz.js';

const { transactionGo } = await vi.hoisted(
  async () => (await import('./quiz.fixtures.js')).spies,
);

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
  view: viewQuiz,
  submitAttempt: submitQuizAttempt,
  myAttempts: myQuizAttempts,
});

const callAsUser = () => callerFor(router, { sub: USER_SUB });

const callAnonymously = () => callerFor(router);

const submit = (answers: Record<string, string[]>, questionsHash = 'hash-4') =>
  callAsUser().submitAttempt({ ...ref, questionsHash, answers });

beforeEach(installDefaults);

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
      go: vi
        .fn()
        .mockResolvedValue({ data: [storedAttempt], cursor: 'next-page' }),
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
      attempts: {
        items: [
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
        cursor: 'next-page',
      },
      reveal: {
        q1: { correctOptionIds: ['b'], explanation: SECRET_EXPLANATION },
        q2: { correctOptionIds: ['a', 'c'] },
      },
    });
  });

  it('returns no summary, attempts or reveal before the first attempt', async () => {
    await expect(callAsUser().myAttempts(ref)).resolves.toEqual({
      summary: null,
      attempts: { items: [], cursor: null },
      reveal: null,
    });
  });

  // Invariant: the history is read a page at a time, since with unlimited
  // attempts it has no bound.
  it('reads one page of attempts, latest first, 10 by default', async () => {
    await callAsUser().myAttempts(ref);

    expect(attemptQuery.mock.results[0].value.go).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      order: 'desc',
    });
  });

  it('reads the page the cursor names, with the limit asked for', async () => {
    await callAsUser().myAttempts({ ...ref, cursor: 'page-2', limit: 25 });

    expect(attemptQuery.mock.results[0].value.go).toHaveBeenCalledWith({
      cursor: 'page-2',
      limit: 25,
      order: 'desc',
    });
  });

  it('is a BAD_REQUEST for a page of more than 100 attempts', async () => {
    await expect(
      callAsUser().myAttempts({ ...ref, limit: 101 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(attemptQuery).not.toHaveBeenCalled();
  });

  it('doesn’t reveal the answers the settings hold back', async () => {
    existingSummary({});
    withSettings({ revealAnswers: 'after_final_attempt' });

    const result = await callAsUser().myAttempts(ref);

    expect(result.reveal).toBeNull();
    expect(JSON.stringify(result)).not.toContain(SECRET_EXPLANATION);
  });
});
