/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { useCoreTable } from '../test-support/core-table.js';
import {
  type VideoAnswer,
  type VideoAnswerEntry,
  videoAnswerWrites,
  videoFirstRecordCheck,
  videoQuestionsOf,
} from './video-question.js';

// The requests ElectroDB would send, checked without a table.

const coreTable = useCoreTable();

const entry = (answeredAt: string): VideoAnswerEntry => ({
  optionIds: ['a'],
  correct: true,
  answeredAt,
  quizVersion: 2,
});
const first = entry('2026-10-28T10:00:00.000Z');
const second = entry('2026-10-28T10:05:00.000Z');

const base: VideoAnswer = {
  userId: 'student-1',
  courseId: 'course-1',
  moduleId: 'module-1',
  lessonId: 'lesson-1',
  contentItemId: 'video-1',
  questionId: 'q2',
  entry: second,
  completed: false,
};

interface Conditional {
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

interface TransactItem {
  ConditionCheck?: Conditional & { Key: Record<string, string> };
  Update?: Conditional & {
    Key: Record<string, string>;
    UpdateExpression: string;
  };
  Put?: Conditional & { Item: Record<string, unknown> };
}

const itemsFor = (input: VideoAnswer): TransactItem[] =>
  coreTable.transaction
    .write((entities) => videoAnswerWrites(entities, input))
    .params().TransactItems as TransactItem[];

const sheetOf = (...answered: [string, VideoAnswerEntry][]) => ({
  answers: Object.fromEntries(answered),
  answerCount: answered.length,
});

const filled = (request: Conditional) =>
  (request.ConditionExpression ?? '').replace(
    /#\w+|:\w+/g,
    (token) =>
      `${request.ExpressionAttributeNames?.[token] ?? request.ExpressionAttributeValues?.[token] ?? token}`,
  );

describe('videoQuestionsOf', () => {
  it('gives the questions, key and version of a video that has them', () => {
    const questions = [{ questionId: 'q1' }];
    const answerKey = { q1: { correctOptionIds: ['a'] } };
    expect(videoQuestionsOf({ questions, answerKey, quizVersion: 3 })).toEqual({
      questions,
      answerKey,
      quizVersion: 3,
    });
  });

  it('gives an empty list, an empty key and 0 when it has none', () => {
    expect(videoQuestionsOf({})).toEqual({
      questions: [],
      answerKey: {},
      quizVersion: 0,
    });
  });
});

describe('videoFirstRecordCheck', () => {
  it('checks the other record does not exist', () => {
    for (const other of ['completion', 'sheet'] as const) {
      const [check] = coreTable.transaction
        .write((entities) => [videoFirstRecordCheck(entities, base, other)])
        .params().TransactItems as TransactItem[];
      expect(filled(check.ConditionCheck as Conditional)).toBe(
        'attribute_not_exists(userId)',
      );
    }
  });
});

describe('videoAnswerWrites', () => {
  const increments = (items: TransactItem[]) =>
    items.some((i) =>
      i.Update?.UpdateExpression.includes('studentActivityCount'),
    );
  const checksCompletion = (items: TransactItem[]) =>
    items.filter(
      (i) =>
        i.ConditionCheck &&
        filled(i.ConditionCheck) === 'attribute_not_exists(userId)',
    ).length;

  it('counts the learner and checks for a completion on a first answer', () => {
    const items = itemsFor({ ...base, entry: first, questionId: 'q1' });

    expect(items).toHaveLength(7);
    expect(increments(items)).toBe(true);
    expect(checksCompletion(items)).toBe(1);
    expect(items.some((i) => i.Put)).toBe(true);
    // Judged against the version the learner was shown.
    expect(JSON.stringify(items)).toContain('quizVersion');
  });

  it('does not count the learner when a completion exists', () => {
    const items = itemsFor({ ...base, completed: true, entry: first });

    expect(items).toHaveLength(6);
    expect(increments(items)).toBe(false);
    expect(checksCompletion(items)).toBe(0);
    expect(items.some((i) => i.Put)).toBe(true);
  });

  it('patches the sheet on a later answer, conditioned on its count', () => {
    const items = itemsFor({
      ...base,
      sheet: sheetOf(['q1', first]),
    });

    expect(items).toHaveLength(6);
    expect(increments(items)).toBe(false);
    expect(checksCompletion(items)).toBe(0);
    const patch = items.find(
      (i) =>
        i.Update &&
        !i.Update.UpdateExpression.includes('studentActivityCount') &&
        i.Update.UpdateExpression.includes('answerCount'),
    )?.Update as NonNullable<TransactItem['Update']>;
    expect(filled(patch)).toContain('answerCount = 1');
    const values = Object.values(patch.ExpressionAttributeValues ?? {});
    expect(values).toContainEqual({ q1: first, q2: second });
    expect(values).toContain(2);
  });

  // Invariant: an entry is added once and never changed or removed.
  it('refuses to change an entry that is already recorded', () => {
    expect(() =>
      itemsFor({ ...base, questionId: 'q1', sheet: sheetOf(['q1', first]) }),
    ).toThrow('already answered');
  });
});
