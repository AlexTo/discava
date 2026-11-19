/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  allCorrect,
  cancelledWith,
  db,
  entities,
  existingSummary,
  installDefaults,
  itemOf,
  quizItem,
  ref,
  SECRET_EXPLANATION,
  TransactionItem,
  transactionEntity,
  transactions,
  USER_SUB,
  withSettings,
} from './quiz.fixtures.js';
import { submitQuizAttempt } from './quiz.js';

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
  submitAttempt: submitQuizAttempt,
});

const callAsUser = () => callerFor(router, { sub: USER_SUB });

const submit = (answers: Record<string, string[]>, questionsHash = 'hash-4') =>
  callAsUser().submitAttempt({ ...ref, questionsHash, answers });

beforeEach(installDefaults);

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
      'enrolment.patch',
      'quizSummary.create',
      'quizAttempt.create',
      // It passes, so it also completes the quiz.
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
      condition:
        'visibility = visible AND notExists(archivedAt) AND quizVersion = 4',
    });
    // Still enrolled, and the attempt is their latest activity.
    expect(itemOf(transaction, 'enrolment')).toMatchObject({
      op: 'patch',
      key: { courseId: 'course-1', userId: USER_SUB },
      set: { lastActivityAt: result.attempt.submittedAt },
      // ...and no later activity landed since (#71).
      condition: `exists(userId) AND status <> dropped AND (notExists(lastActivityAt) OR lastActivityAt <= ${result.attempt.submittedAt})`,
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

  describe('completing the quiz', () => {
    const completionIn = (transaction: TransactionItem[]) =>
      transaction.find((item) => item.entity === 'itemCompletion');

    // Invariant: a quiz is complete once passed, or once all attempts are used.
    it('records the completion with a passing attempt', async () => {
      existingSummary({ attemptsUsed: 1, bestScore: 0 });

      const result = await submit(allCorrect);

      const [transaction] = transactions;
      expect(completionIn(transaction)).toMatchObject({
        op: 'create',
        data: {
          userId: USER_SUB,
          ...ref,
          completedAt: result.attempt.submittedAt,
        },
      });
      // Its activity was counted by the first attempt, not again here.
      expect(itemOf(transaction, 'contentItem').op).toBe('check');
    });

    it('records the completion with the last attempt, even when it fails', async () => {
      existingSummary({ attemptsUsed: 2, bestScore: 0 });

      const result = await submit({});

      expect(result.attempt.passed).toBe(false);
      expect(completionIn(transactions[0])).toMatchObject({ op: 'create' });
    });

    it('doesn’t complete the quiz on a failed attempt with attempts left', async () => {
      existingSummary({ attemptsUsed: 1, bestScore: 0 });

      await submit({});

      expect(completionIn(transactions[0])).toBeUndefined();
    });

    it('never completes a quiz with unlimited attempts until it’s passed', async () => {
      withSettings({ attemptsAllowed: null });
      existingSummary({ attemptsUsed: 40, bestScore: 0 });

      await submit({});

      expect(completionIn(transactions[0])).toBeUndefined();
    });

    // Invariant: at most one completion per student and item.
    it('doesn’t record a second completion', async () => {
      existingSummary({
        attemptsUsed: 1,
        passedAt: '2024-01-03T00:00:00.000Z',
      });
      db.itemCompletion = {
        userId: USER_SUB,
        ...ref,
        completedAt: '2024-01-03T00:00:00.000Z',
      };

      await submit(allCorrect);

      expect(completionIn(transactions[0])).toBeUndefined();
    });

    it('rereads after a completion lands at the same moment, and doesn’t write another', async () => {
      existingSummary({ attemptsUsed: 1, bestScore: 0 });
      transactionGo
        .mockImplementationOnce(async () => {
          // completed through contentItem.complete in between
          db.itemCompletion = {
            userId: USER_SUB,
            ...ref,
            completedAt: '2024-01-03T00:00:00.000Z',
          };
          return cancelledWith([
            'None',
            'None',
            'None',
            'None',
            'None',
            'None',
            'None',
            'ConditionalCheckFailed',
          ]);
        })
        .mockResolvedValueOnce({ canceled: false, data: [] });

      await submit(allCorrect);

      expect(transactions).toHaveLength(2);
      expect(completionIn(transactions[0])).toBeDefined();
      expect(completionIn(transactions[1])).toBeUndefined();
    });
  });
});
