/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { attemptsRemain, type QuizQuestion, reconcile, shuffled } from './quiz';

const question = (
  questionId: string,
  overrides: Partial<QuizQuestion> = {},
): QuizQuestion => ({
  questionId,
  kind: 'single',
  prompt: `prompt ${questionId}`,
  options: [
    { optionId: 'a', text: 'A' },
    { optionId: 'b', text: 'B' },
    { optionId: 'c', text: 'C' },
  ],
  ...overrides,
});

describe('shuffled', () => {
  const options = Array.from({ length: 8 }, (_, i) => i);

  it('gives the same order for the same seed', () => {
    expect(shuffled(options, 'quiz-1:1')).toEqual(
      shuffled(options, 'quiz-1:1'),
    );
  });

  it('gives a new order for the next attempt, keeping every option', () => {
    const first = shuffled(options, 'quiz-1:1');
    const second = shuffled(options, 'quiz-1:2');

    expect(second).not.toEqual(first);
    expect([...second].sort()).toEqual(options);
  });

  it('leaves its input alone', () => {
    shuffled(options, 'quiz-1:1');
    expect(options).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('attemptsRemain', () => {
  it.each([
    [3, 2, true],
    [3, 3, false],
    [null, 99, true],
  ])('with %s allowed and %s used: %s', (allowed, used, remain) => {
    expect(attemptsRemain({ attemptsAllowed: allowed }, used)).toBe(remain);
  });
});

describe('reconcile', () => {
  it('keeps the answer to an unchanged question, unmarked', () => {
    expect(
      reconcile([question('q1')], [question('q1')], { q1: ['b'] }),
    ).toEqual({ answers: { q1: ['b'] }, markers: {} });
  });

  it('drops the answer to a removed question', () => {
    expect(
      reconcile([question('q1'), question('q2')], [question('q2')], {
        q1: ['a'],
        q2: ['c'],
      }),
    ).toEqual({ answers: { q2: ['c'] }, markers: {} });
  });

  it('marks a new question, unanswered', () => {
    expect(
      reconcile([question('q1')], [question('q1'), question('q2')], {
        q1: ['a'],
      }),
    ).toEqual({ answers: { q1: ['a'] }, markers: { q2: 'new' } });
  });

  it('marks a reworded question updated, keeping its answer', () => {
    expect(
      reconcile([question('q1')], [question('q1', { prompt: 'reworded' })], {
        q1: ['a'],
      }),
    ).toEqual({ answers: { q1: ['a'] }, markers: { q1: 'updated' } });
  });

  it('keeps only the chosen options that still exist', () => {
    const before = question('q1', { kind: 'multiple' });
    const after = question('q1', {
      kind: 'multiple',
      options: [
        { optionId: 'a', text: 'A' },
        { optionId: 'd', text: 'D' },
      ],
    });

    expect(reconcile([before], [after], { q1: ['a', 'b'] })).toEqual({
      answers: { q1: ['a'] },
      markers: { q1: 'updated' },
    });
  });

  it('keeps a multiple choice answer for a now single choice question only if one option is left', () => {
    const before = question('q1', { kind: 'multiple' });
    const after = question('q1');

    expect(reconcile([before], [after], { q1: ['a', 'b'] }).answers).toEqual(
      {},
    );
    expect(reconcile([before], [after], { q1: ['c'] }).answers).toEqual({
      q1: ['c'],
    });
  });

  it('counts reordered options as a change', () => {
    const after = question('q1', {
      options: [...question('q1').options].reverse(),
    });

    expect(reconcile([question('q1')], [after], {}).markers).toEqual({
      q1: 'updated',
    });
  });
});
