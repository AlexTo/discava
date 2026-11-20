/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_DOC } from '../quiz/quiz-form';
import {
  canMove,
  formatTime,
  fromVideoItem,
  hasErrors,
  isAfterEnd,
  MAX_VIDEO_QUESTIONS,
  moveWithinMoment,
  newVideoQuestion,
  parseTime,
  sortQuestions,
  toVideoQuestionsInput,
  type VideoQuestionState,
  validateVideoQuestions,
} from './video-questions-form';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const valid = (id: string, atSeconds: number | null): VideoQuestionState => ({
  questionId: id,
  kind: 'single',
  prompt: doc(`Question ${id}`),
  options: [
    { optionId: `${id}-a`, text: 'Yes' },
    { optionId: `${id}-b`, text: 'No' },
  ],
  correct: [`${id}-a`],
  explanation: '',
  atSeconds,
});

const ids = (questions: VideoQuestionState[]) =>
  questions.map((q) => q.questionId);

describe('formatTime and parseTime', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [90, '1:30'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
  ])('%s seconds is %s, both ways', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
    expect(parseTime(text)).toBe(seconds);
  });

  it('reads minutes past an hour as m:ss', () => {
    expect(parseTime('75:00')).toBe(4500);
  });

  it.each([
    '',
    '1',
    '1:5',
    '1:60',
    '-1:00',
    '1:30.5',
    'abc',
    '1:02:60',
    '1:2:03',
  ])('refuses %j', (text) => {
    expect(parseTime(text)).toBeUndefined();
  });

  it('ignores spaces around the time', () => {
    expect(parseTime(' 1:30 ')).toBe(90);
  });
});

describe('sortQuestions', () => {
  it('orders by time, keeping the given order for ties, end questions last', () => {
    const sorted = sortQuestions([
      valid('end1', null),
      valid('late', 30),
      valid('tieA', 10),
      valid('end2', null),
      valid('tieB', 10),
      valid('early', 2),
    ]);

    expect(ids(sorted)).toEqual([
      'early',
      'tieA',
      'tieB',
      'late',
      'end1',
      'end2',
    ]);
  });

  it('puts a question with an unparsed time with the end ones', () => {
    expect(
      ids(sortQuestions([valid('bad', Number.NaN), valid('a', 1)])),
    ).toEqual(['a', 'bad']);
  });
});

describe('moveWithinMoment', () => {
  const list = [valid('a', 5), valid('b', 5), valid('c', 9), valid('d', null)];

  it('swaps neighbours at the same moment', () => {
    expect(ids(moveWithinMoment(list, 'a', 'down'))).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
    expect(ids(moveWithinMoment(list, 'b', 'up'))).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
  });

  it('swaps end questions among themselves', () => {
    const ends = [valid('e1', null), valid('e2', null)];
    expect(ids(moveWithinMoment(ends, 'e2', 'up'))).toEqual(['e2', 'e1']);
  });

  it('never moves a question across moments or off either edge', () => {
    expect(moveWithinMoment(list, 'b', 'down')).toBe(list);
    expect(moveWithinMoment(list, 'c', 'up')).toBe(list);
    expect(moveWithinMoment(list, 'a', 'up')).toBe(list);
    expect(moveWithinMoment(list, 'd', 'down')).toBe(list);
    expect(moveWithinMoment(list, 'missing', 'up')).toBe(list);
  });

  it('says whether a move is possible', () => {
    expect(canMove(list, 'a', 'down')).toBe(true);
    expect(canMove(list, 'c', 'down')).toBe(false);
  });
});

describe('isAfterEnd', () => {
  it('is true at or past the duration, never for an end question', () => {
    expect(isAfterEnd(valid('a', 9), 10)).toBe(false);
    expect(isAfterEnd(valid('a', 10), 10)).toBe(true);
    expect(isAfterEnd(valid('a', 11), 10)).toBe(true);
    expect(isAfterEnd(valid('a', null), 10)).toBe(false);
  });
});

describe('validateVideoQuestions', () => {
  it('accepts valid questions, none at all, and 20 of them', () => {
    expect(hasErrors(validateVideoQuestions([]))).toBe(false);
    expect(
      hasErrors(validateVideoQuestions([valid('a', 0), valid('b', null)])),
    ).toBe(false);
    expect(
      hasErrors(
        validateVideoQuestions(
          Array.from({ length: MAX_VIDEO_QUESTIONS }, (_, i) =>
            valid(`q${i}`, i),
          ),
        ),
      ),
    ).toBe(false);
  });

  it("applies the quiz's per-question rules", () => {
    const empty = { ...newVideoQuestion(3), questionId: 'empty' };

    const errors = validateVideoQuestions([empty]);

    expect(errors.questions.empty).toContain('Write the question.');
    expect(errors.questions.empty).toContain(
      'Fill in every option, or remove the empty ones.',
    );
    expect(empty.prompt).toBe(EMPTY_DOC);
  });

  it.each([[Number.NaN], [-1], [1.5], [86_401]])(
    'refuses the time %s',
    (atSeconds) => {
      const errors = validateVideoQuestions([valid('a', atSeconds)]);

      expect(errors.questions.a?.[0]).toMatch(/time like 1:30/);
    },
  );

  it('refuses more than 20 questions', () => {
    const errors = validateVideoQuestions(
      Array.from({ length: MAX_VIDEO_QUESTIONS + 1 }, (_, i) =>
        valid(`q${i}`, i),
      ),
    );

    expect(errors.video).toEqual(['A video can have at most 20 questions.']);
  });
});

describe('fromVideoItem and toVideoQuestionsInput', () => {
  const item = {
    questions: [
      {
        questionId: 'q1',
        kind: 'single' as const,
        prompt: doc('One'),
        options: [
          { optionId: 'a', text: 'Yes' },
          { optionId: 'b', text: 'No' },
        ],
        atSeconds: 12,
      },
      {
        questionId: 'q2',
        kind: 'single' as const,
        prompt: doc('Two'),
        options: [
          { optionId: 'a', text: 'Yes' },
          { optionId: 'b', text: 'No' },
        ],
        atSeconds: null,
      },
    ],
    answerKey: {
      q1: { correctOptionIds: ['b'], explanation: doc('Because') },
      q2: { correctOptionIds: ['a'] },
    },
    quizVersion: 4,
  };

  it('has no questions for a video that never had any', () => {
    expect(fromVideoItem({})).toEqual([]);
  });

  it('joins each question with its key entry and keeps its time', () => {
    const [first, second] = fromVideoItem(item);

    expect(first).toMatchObject({
      questionId: 'q1',
      correct: ['b'],
      explanation: doc('Because'),
      atSeconds: 12,
    });
    expect(second).toMatchObject({
      correct: ['a'],
      explanation: '',
      atSeconds: null,
    });
  });

  it('round-trips to the API input, with the key apart from the questions', () => {
    const input = toVideoQuestionsInput(fromVideoItem(item), 4);

    expect(input.quizVersion).toBe(4);
    expect(input.questions).toEqual(item.questions);
    expect(input.answerKey).toEqual(item.answerKey);
    expect(JSON.stringify(input.questions)).not.toContain('correct');
  });

  it('sends an empty list with an empty key', () => {
    expect(toVideoQuestionsInput([], 0)).toEqual({
      quizVersion: 0,
      questions: [],
      answerKey: {},
    });
  });
});
