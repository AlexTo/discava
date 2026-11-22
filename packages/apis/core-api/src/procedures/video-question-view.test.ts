/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  db,
  entities,
  entry,
  existingSheet,
  installDefaults,
  ref,
  SECRET_EXPLANATION,
  TRANSACTION_ENTITIES,
  type TransactionItem,
  transactionEntity,
  transactions,
  USER_SUB,
  videoItem,
} from './video-question.fixtures.js';
import { viewVideoQuestions } from './video-question.js';

const { transactionGo } = await vi.hoisted(
  async () => (await import('./video-question.fixtures.js')).spies,
);

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities,
    transaction: {
      write: (build: (e: unknown) => TransactionItem[]) => {
        transactions.push(
          build(
            Object.fromEntries(
              TRANSACTION_ENTITIES.map((name) => [
                name,
                transactionEntity(name),
              ]),
            ),
          ),
        );
        return { go: transactionGo };
      },
    },
  })),
}));

const router = t.router({ view: viewVideoQuestions });

const asUser = () => callerFor(router, { sub: USER_SUB });

beforeEach(installDefaults);

describe('videoQuestion.view access', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(callerFor(router).view(ref)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('is FORBIDDEN without an enrolment in a published course', async () => {
    db.enrolment = null;
    await expect(asUser().view(ref)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is FORBIDDEN with a dropped enrolment', async () => {
    db.enrolment = { ...db.enrolment, status: 'dropped' };
    await expect(asUser().view(ref)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is NOT_FOUND without an enrolment in a course that is not published', async () => {
    db.enrolment = null;
    db.course = { ...db.course, status: 'draft' };
    await expect(asUser().view(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each([
    ['the video is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['the video is archived', () => (db.contentItem.archivedAt = 'x')],
    ['its lesson is hidden', () => (db.lesson.visibility = 'hidden')],
    ['its module is archived', () => (db.module.archivedAt = 'x')],
    ['it does not exist', () => (db.contentItem = null)],
    ['it is not a video', () => (db.contentItem.type = 'text')],
    ['it has nothing playable', () => (db.contentItem.s3Key = undefined)],
  ])('is NOT_FOUND when %s', async (_, change) => {
    db.contentItem = { ...videoItem };
    db.module = { ...db.module };
    db.lesson = { ...db.lesson };
    change();
    await expect(asUser().view(ref)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.any(String),
    });
  });
});

describe('videoQuestion.view', () => {
  // Invariant: the answer key never reaches a learner for an unanswered
  // question.
  it('returns the questions and no answer key before any answer', async () => {
    const result = await asUser().view(ref);

    expect(result.quizVersion).toBe(3);
    expect(result.questions.map((q) => q.questionId)).toEqual(['q1', 'q2']);
    expect(result.questions[0]).toEqual({
      questionId: 'q1',
      kind: 'single',
      prompt: videoItem.questions[0]!.prompt,
      options: videoItem.questions[0]!.options,
      atSeconds: 10,
      contentHash: 'hash-q1',
    });
    expect(result.questions[1]!.atSeconds).toBeNull();
    expect(result.answers).toEqual({});
    const json = JSON.stringify(result);
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain('answerKey');
    expect(json).not.toContain(SECRET_EXPLANATION);
  });

  it('returns the key only for the questions the caller answered', async () => {
    existingSheet({ q1: entry({ optionIds: ['a'], correct: false }) });

    const result = await asUser().view(ref);

    expect(result.answers).toEqual({
      q1: {
        optionIds: ['a'],
        correct: false,
        answeredAt: '2024-01-03T00:00:00.000Z',
        correctOptionIds: ['b'],
        explanation: SECRET_EXPLANATION,
      },
    });
    expect(JSON.stringify(result.questions)).not.toContain('correctOptionIds');
    expect(JSON.stringify(result)).not.toContain('"q2":{');
  });

  it('gives an empty result for a video without questions', async () => {
    db.contentItem = {
      ...videoItem,
      questions: undefined,
      answerKey: undefined,
    };
    await expect(asUser().view(ref)).resolves.toEqual({
      quizVersion: 0,
      questions: [],
      answers: {},
    });
  });

  it('gives an empty result in an archived course', async () => {
    db.course = { ...db.course, status: 'archived' };
    await expect(asUser().view(ref)).resolves.toEqual({
      quizVersion: 0,
      questions: [],
      answers: {},
    });
  });

  it('leaves out an answer to a question that was removed', async () => {
    existingSheet({ gone: entry(), q1: entry() });
    const result = await asUser().view(ref);
    expect(Object.keys(result.answers)).toEqual(['q1']);
  });

  it('keeps the recorded result but shows the current key', async () => {
    // Answered b (correct then); the key has since changed to a.
    existingSheet({ q1: entry({ optionIds: ['b'], correct: true }) });
    db.contentItem = {
      ...videoItem,
      answerKey: { ...videoItem.answerKey, q1: { correctOptionIds: ['a'] } },
    };

    const { answers } = await asUser().view(ref);

    expect(answers.q1).toMatchObject({
      correct: true,
      optionIds: ['b'],
      correctOptionIds: ['a'],
    });
    expect(answers.q1!.explanation).toBeUndefined();
  });
});
