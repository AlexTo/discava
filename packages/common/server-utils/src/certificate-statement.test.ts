/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { assessmentStatement } from './certificate-statement.js';

const none = {
  criteriaVersion: 1,
  requireQuizPass: false,
  itemCount: 14,
  assessedItemCount: 0,
  assessedItems: [],
};

const quizzes = (overrides: Record<string, unknown> = {}) => ({
  criteriaVersion: 2,
  requireQuizPass: true,
  itemCount: 14,
  assessedItemCount: 3,
  assessedItems: [
    {
      contentItemId: 'q1',
      kind: 'quiz',
      scorePercent: 85,
      passMarkPercent: 70,
    },
    {
      contentItemId: 'q2',
      kind: 'quiz',
      scorePercent: 80,
      passMarkPercent: 70,
    },
    {
      contentItemId: 'q3',
      kind: 'quiz',
      scorePercent: 78,
      passMarkPercent: 70,
    },
  ],
  passMarkLowest: 70,
  passMarkHighest: 70,
  scoreBand: 80,
  ...overrides,
});

describe('assessmentStatement', () => {
  it('says no graded assessment was required when nothing was', () => {
    expect(assessmentStatement(none as any)).toEqual([
      'Completed all 14 items of the course.',
      'No graded assessment was required for this certificate.',
    ]);
  });

  it('uses the singular for one assessed quiz', () => {
    expect(
      assessmentStatement(quizzes({ assessedItemCount: 1 }) as any),
    ).toEqual([
      'Completed all 14 items of the course.',
      'Passed 1 assessed quiz. Pass mark: 70%.',
      'Overall score: 80–89%.',
    ]);
  });

  it('gives one pass mark for three quizzes', () => {
    expect(assessmentStatement(quizzes() as any)).toEqual([
      'Completed all 14 items of the course.',
      'Passed 3 assessed quizzes. Pass mark: 70%.',
      'Overall score: 80–89%.',
    ]);
  });

  it('gives the range when pass marks differ', () => {
    expect(
      assessmentStatement(
        quizzes({ passMarkLowest: 60, passMarkHighest: 80 }) as any,
      )[1],
    ).toBe('Passed 3 assessed quizzes. Pass marks: 60% to 80%.');
  });

  it('prints the top band as 90–100%', () => {
    expect(assessmentStatement(quizzes({ scoreBand: 90 }) as any)[2]).toBe(
      'Overall score: 90–100%.',
    );
  });

  it('counts graded assignments on their own line, after the quizzes', () => {
    expect(
      assessmentStatement(
        quizzes({
          assessedItemCount: 5,
          assessedUploadCount: 2,
          minUploadScorePercent: 60,
        }) as any,
      ),
    ).toEqual([
      'Completed all 14 items of the course.',
      'Passed 3 assessed quizzes. Pass mark: 70%.',
      'Graded assignments returned with at least 60%: 2.',
      'Overall score: 80–89%.',
    ]);
  });

  it('has no quiz line when only graded assignments were required', () => {
    expect(
      assessmentStatement({
        ...none,
        assessedItemCount: 1,
        assessedUploadCount: 1,
        minUploadScorePercent: 60,
        scoreBand: 70,
      } as any),
    ).toEqual([
      'Completed all 14 items of the course.',
      'Graded assignments returned with at least 60%: 1.',
      'Overall score: 70–79%.',
    ]);
  });

  it('adds the course length, singular for one hour', () => {
    expect(assessmentStatement({ ...none, courseHours: 12 } as any)).toEqual([
      'Completed all 14 items of the course.',
      'No graded assessment was required for this certificate.',
      'Course length: 12 hours.',
    ]);
    expect(assessmentStatement({ ...none, courseHours: 1 } as any).at(-1)).toBe(
      'Course length: 1 hour.',
    );
  });

  it('is not changed by the internal fields', () => {
    const base = quizzes();
    expect(
      assessmentStatement({
        ...base,
        criteriaVersion: 99,
        assessedItems: [],
      } as any),
    ).toEqual(assessmentStatement(base as any));
  });
});
