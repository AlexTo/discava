/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CERTIFICATE_CRITERIA,
  evaluateCertificateCriteria,
  scoreBand,
} from './certificate-criteria.js';

const shown = { visibility: 'visible' as const };
const quiz = (
  id: string,
  passMarkPercent: number,
  extra: Record<string, unknown> = {},
  order = 1,
) => ({
  ...shown,
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: id,
  order,
  type: 'quiz',
  settings: { passMarkPercent, attemptsAllowed: null },
  ...extra,
});
const text = {
  ...shown,
  moduleId: 'm1',
  lessonId: 'l1',
  contentItemId: 't1',
  order: 0,
  type: 'text',
};
const curriculumOf = (
  contentItems: ReturnType<typeof quiz>[] | (typeof text)[],
  lessonExtra: Record<string, unknown> = {},
) => ({
  modules: [{ ...shown, moduleId: 'm1', order: 1 }],
  lessons: [
    { ...shown, moduleId: 'm1', lessonId: 'l1', order: 1, ...lessonExtra },
  ],
  contentItems: contentItems as never,
});
const summary = (
  contentItemId: string,
  bestScore: number,
  passed: boolean,
  attemptsUsed = 1,
) => ({
  contentItemId,
  attemptsUsed,
  bestScore,
  ...(passed && { passedAt: '2026-01-01T00:00:00.000Z' }),
});
const required = { version: 2, requireQuizPass: true };

describe('scoreBand', () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 10],
    [89, 80],
    [90, 90],
    [100, 90],
  ])('puts %i in band %i', (percent, band) => {
    expect(scoreBand(percent)).toBe(band);
  });
});

describe('evaluateCertificateCriteria', () => {
  it('meets the default criteria with an empty list and no band', () => {
    const { met, requirements, assessment } = evaluateCertificateCriteria({
      criteria: DEFAULT_CERTIFICATE_CRITERIA,
      curriculum: curriculumOf([text, quiz('q1', 70)]),
      quizSummaries: [],
    });
    expect(met).toBe(true);
    expect(requirements).toEqual([]);
    expect(assessment).toEqual({
      criteriaVersion: 1,
      requireQuizPass: false,
      itemCount: 2,
      assessedItemCount: 0,
      assessedItems: [],
    });
  });

  it('is not met while a quiz is failed', () => {
    const { met, requirements } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)]),
      quizSummaries: [summary('q1', 50, false)],
    });
    expect(met).toBe(false);
    expect(requirements).toEqual([
      {
        kind: 'pass-quizzes',
        quizzes: [{ contentItemId: 'q1', state: 'not-passed' }],
      },
    ]);
  });

  it('is met with every quiz passed, counting them and giving the marks and band', () => {
    const { met, assessment } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 60, {}, 1), quiz('q2', 80, {}, 2)]),
      quizSummaries: [summary('q1', 89, true), summary('q2', 81, true)],
    });
    expect(met).toBe(true);
    expect(assessment).toMatchObject({
      criteriaVersion: 2,
      requireQuizPass: true,
      assessedItemCount: 2,
      passMarkLowest: 60,
      passMarkHighest: 80,
      scoreBand: 80,
      assessedItems: [
        {
          contentItemId: 'q1',
          kind: 'quiz',
          scorePercent: 89,
          passMarkPercent: 60,
        },
        {
          contentItemId: 'q2',
          kind: 'quiz',
          scorePercent: 81,
          passMarkPercent: 80,
        },
      ],
    });
  });

  it('does not assess a quiz with pass mark 0, a hidden quiz or one in an archived lesson', () => {
    for (const [items, lessonExtra] of [
      [[quiz('q1', 0)], {}],
      [[quiz('q1', 70, { visibility: 'hidden' })], {}],
      [[quiz('q1', 70)], { archivedAt: '2026-01-01T00:00:00.000Z' }],
    ] as const) {
      const { met, assessment } = evaluateCertificateCriteria({
        criteria: required,
        curriculum: curriculumOf([...items], lessonExtra),
        quizSummaries: [],
      });
      expect(met).toBe(true);
      expect(assessment.assessedItemCount).toBe(0);
      expect(assessment.scoreBand).toBeUndefined();
    }
  });

  it('counts a quiz in an assignment lesson', () => {
    const { met } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)], { kind: 'assignment' }),
      quizSummaries: [],
    });
    expect(met).toBe(false);
  });

  it('is met with no assessed quiz at all', () => {
    const { met, assessment } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([text]),
      quizSummaries: [],
    });
    expect(met).toBe(true);
    expect(assessment.assessedItemCount).toBe(0);
  });

  it('does not count a quiz passed under a pass mark that has since been raised past the best score', () => {
    const { met, requirements } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)]),
      // Passed at 60 when the mark was 50; the mark is now 70.
      quizSummaries: [summary('q1', 60, true)],
    });
    expect(met).toBe(false);
    expect(requirements[0].quizzes).toEqual([
      { contentItemId: 'q1', state: 'not-passed' },
    ]);
  });

  it('still counts it when the best score reaches the raised mark', () => {
    const { met, assessment } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([quiz('q1', 70)]),
      quizSummaries: [summary('q1', 70, true)],
    });
    expect(met).toBe(true);
    expect(assessment.assessedItems[0]).toMatchObject({
      scorePercent: 70,
      passMarkPercent: 70,
    });
  });

  it('gives each requirement state', () => {
    const limited = (id: string, order: number) =>
      quiz(
        id,
        70,
        { settings: { passMarkPercent: 70, attemptsAllowed: 2 } },
        order,
      );
    const { requirements } = evaluateCertificateCriteria({
      criteria: required,
      curriculum: curriculumOf([
        quiz('passed', 70, {}, 1),
        quiz('none', 70, {}, 2),
        limited('out', 3),
        quiz('failed', 70, {}, 4),
      ]),
      quizSummaries: [
        summary('passed', 90, true),
        summary('out', 10, false, 2),
        summary('failed', 10, false, 5),
      ],
    });
    expect(requirements[0].quizzes.map((q) => q.state)).toEqual([
      'passed',
      'not-attempted',
      'no-attempts-left',
      'not-passed',
    ]);
  });
});
