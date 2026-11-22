/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  cancelledWith,
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
import { answerVideoQuestion } from './video-question.js';

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

const router = t.router({ answer: answerVideoQuestion });

const asUser = () => callerFor(router, { sub: USER_SUB });

const answer = (
  optionIds: string[],
  questionId = 'q1',
  contentHash = `hash-${questionId}`,
) => asUser().answer({ ...ref, questionId, optionIds, contentHash });

beforeEach(installDefaults);

describe('videoQuestion.answer access', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      callerFor(router).answer({
        ...ref,
        questionId: 'q1',
        optionIds: ['b'],
        contentHash: 'hash-q1',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('is FORBIDDEN without an enrolment or with a dropped one', async () => {
    db.enrolment = null;
    await expect(answer(['b'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    db.enrolment = { status: 'dropped' };
    await expect(answer(['b'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(transactions).toHaveLength(0);
  });

  it.each([
    ['the video is hidden', () => (db.contentItem.visibility = 'hidden')],
    ['its lesson is archived', () => (db.lesson.archivedAt = 'x')],
    ['its module is hidden', () => (db.module.visibility = 'hidden')],
    ['it is not a video', () => (db.contentItem.type = 'quiz')],
  ])('is NOT_FOUND when %s', async (_, change) => {
    db.contentItem = { ...videoItem };
    db.module = { ...db.module };
    db.lesson = { ...db.lesson };
    change();
    await expect(answer(['b'])).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This video is not available',
    });
    expect(transactions).toHaveLength(0);
  });

  it('is PRECONDITION_FAILED in an archived course', async () => {
    db.course = { ...db.course, status: 'archived' };
    await expect(answer(['b'])).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This course is archived, so its questions are closed',
    });
    expect(transactions).toHaveLength(0);
  });
});

describe('videoQuestion.answer', () => {
  it('grades a correct single-choice answer and records it', async () => {
    const result = await answer(['b']);

    expect(result).toMatchObject({
      optionIds: ['b'],
      correct: true,
      correctOptionIds: ['b'],
      explanation: SECRET_EXPLANATION,
      recorded: true,
    });
    expect(transactions).toHaveLength(1);
  });

  it('grades a wrong answer as not correct', async () => {
    await expect(answer(['a'])).resolves.toMatchObject({
      correct: false,
      correctOptionIds: ['b'],
      recorded: true,
    });
  });

  it('grades multiple choice all-or-nothing', async () => {
    await expect(answer(['a', 'c'], 'q2')).resolves.toMatchObject({
      correct: true,
    });
    await expect(answer(['a'], 'q2')).resolves.toMatchObject({
      correct: false,
    });
    await expect(answer(['a', 'b', 'c'], 'q2')).resolves.toMatchObject({
      correct: false,
    });
  });

  it('is NOT_FOUND for a question that is not on the video', async () => {
    await expect(answer(['b'], 'gone', 'x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This question is no longer part of the video',
    });
    expect(transactions).toHaveLength(0);
  });

  it('returns the record without writing when already answered, whatever was sent', async () => {
    existingSheet({ q1: entry({ optionIds: ['a'], correct: false }) });

    const result = await answer(['b'], 'q1', 'a-stale-hash');

    expect(result).toMatchObject({
      optionIds: ['a'],
      correct: false,
      correctOptionIds: ['b'],
      recorded: false,
    });
    expect(transactions).toHaveLength(0);
  });

  it('refuses a changed question by hash and writes nothing', async () => {
    await expect(answer(['b'], 'q1', 'old-hash')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This question was updated. Check it before answering',
    });
    expect(transactions).toHaveLength(0);
  });

  it('grades against the current key after a key-only edit', async () => {
    db.contentItem = {
      ...videoItem,
      answerKey: { ...videoItem.answerKey, q1: { correctOptionIds: ['a'] } },
    };
    await expect(answer(['a'])).resolves.toMatchObject({
      correct: true,
      correctOptionIds: ['a'],
    });
  });

  it('accepts a question that was moved on the timeline', async () => {
    db.contentItem = {
      ...videoItem,
      questions: videoItem.questions.map((q) => ({ ...q, atSeconds: 99 })),
    };
    await expect(answer(['b'])).resolves.toMatchObject({ recorded: true });
  });

  it.each([
    ['an option that is not the question’s', ['zzz']],
    ['a repeated option', ['a', 'a']],
    ['two options for single choice', ['a', 'b']],
  ])('is BAD_REQUEST for %s', async (_, optionIds) => {
    await expect(answer(optionIds)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Invalid answer to question q1',
    });
    expect(transactions).toHaveLength(0);
  });

  describe('the transaction', () => {
    const entitiesOf = (items: TransactionItem[]) =>
      items.map((item) => `${item.op}:${item.entity}`);

    it('counts the learner and checks for a completion on a first record', async () => {
      await answer(['b']);

      const items = transactions[0]!;
      expect(items.find((i) => i.entity === 'contentItem')!.add).toMatchObject({
        studentActivityCount: 1,
      });
      expect(items).toContainEqual(
        expect.objectContaining({
          entity: 'itemCompletion',
          op: 'check',
          condition: 'notExists(userId)',
        }),
      );
      const sheet = items.find((i) => i.entity === 'videoAnswerSheet')!;
      expect(sheet.op).toBe('create');
      expect(sheet.data).toMatchObject({ answerCount: 1 });
      expect(Object.keys(sheet.data!.answers as object)).toEqual(['q1']);
    });

    it('does not count the learner again after a completion', async () => {
      db.itemCompletion = { completedAt: 'x' };
      await answer(['b']);

      const items = transactions[0]!;
      expect(
        items.find((i) => i.entity === 'contentItem')!.add ?? {},
      ).not.toHaveProperty('studentActivityCount');
      expect(items.some((i) => i.entity === 'itemCompletion')).toBe(false);
    });

    it('patches the sheet on a later answer, conditioned on answerCount', async () => {
      existingSheet({ q1: entry() });
      await answer(['a', 'c'], 'q2');

      const items = transactions[0]!;
      const sheet = items.find((i) => i.entity === 'videoAnswerSheet')!;
      expect(sheet.op).toBe('patch');
      expect(sheet.condition).toBe('answerCount = 1');
      expect(Object.keys(sheet.set!.answers as object)).toEqual(['q1', 'q2']);
      expect(sheet.set!.answerCount).toBe(2);
      expect(items.some((i) => i.entity === 'itemCompletion')).toBe(false);
    });

    // An answer is not a completion (spec FR-024, SC-003).
    it('writes no completion, progress, quiz or certificate record', async () => {
      await answer(['b']);
      expect(
        transactions[0]!
          .filter((i) => i.op !== 'check')
          .map((i) => `${i.op}:${i.entity}`)
          .sort(),
      ).toEqual(
        entitiesOf(transactions[0]!.filter((i) => i.op !== 'check')).sort(),
      );
      const written = new Set(
        transactions[0]!.filter((i) => i.op !== 'check').map((i) => i.entity),
      );
      for (const entity of [
        'itemCompletion',
        'progress',
        'quizAttempt',
        'quizSummary',
        'certificate',
      ]) {
        expect(written.has(entity)).toBe(false);
      }
    });
  });

  describe('a lost race', () => {
    it('returns the answer another request recorded first', async () => {
      transactionGo.mockImplementationOnce(async () => {
        existingSheet({ q1: entry({ optionIds: ['a'] }) });
        return cancelledWith(['ConditionalCheckFailed']);
      });

      await expect(answer(['b'])).resolves.toMatchObject({
        optionIds: ['a'],
        recorded: false,
      });
      expect(transactions).toHaveLength(1);
    });

    it('refuses by hash when the question changed meanwhile', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.contentItem = {
          ...videoItem,
          questions: videoItem.questions.map((q) => ({
            ...q,
            contentHash: 'changed',
          })),
        };
        return cancelledWith(['ConditionalCheckFailed']);
      });

      await expect(answer(['b'])).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('is NOT_FOUND when the video was hidden meanwhile', async () => {
      transactionGo.mockImplementationOnce(async () => {
        db.contentItem = { ...videoItem, visibility: 'hidden' };
        return cancelledWith(['ConditionalCheckFailed']);
      });

      await expect(answer(['b'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('gives CONFLICT after three transaction conflicts', async () => {
      transactionGo.mockResolvedValue(cancelledWith(['TransactionConflict']));
      await expect(answer(['b'])).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(transactions).toHaveLength(3);
    });

    it('fails for a cancellation it does not recognise', async () => {
      transactionGo.mockResolvedValue(cancelledWith(['ValidationError']));
      await expect(answer(['b'])).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
      });
    });
  });
});
