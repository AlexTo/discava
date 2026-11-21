/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { checkTableInvariants as checkAllInvariants } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { consistentTable, testHelpers } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { item } = testHelpers(() => table);

describe('analytics-matches-records', () => {
  const violations = () =>
    checkAllInvariants(table).filter(
      (v) => v.invariant === 'analytics-matches-records',
    );

  it('passes when the aggregates equal the sums over the records', () => {
    expect(violations()).toEqual([]);
  });

  it('passes for a course with no enrolments and no items', () => {
    table.enrolments = [];
    table.itemCompletions = [];
    table.quizAttempts = [];
    table.quizSummaries = [];
    table.videoAnswerSheets = [];
    table.progress = [];
    table.courseStats = [];
    table.periodStats = [];
    table.lessonStats = [];
    table.quizQuestionStats = [];
    table.quizScoreStats = [];
    expect(violations()).toEqual([]);
  });

  it('reports a video answer sheet entry with no matching attempts', () => {
    table.quizQuestionStats = table.quizQuestionStats.filter(
      (q) => q.contentItemId !== 'video',
    );
    expect(violations().map((v) => v.message)).toEqual([
      'attempts is 0, but its records add up to 1',
      'misses is 0, but its records add up to 1',
    ]);
  });

  it('reports an enrolments count that is off by one, with the course', () => {
    table.courseStats = [
      { courseId: 'c1', enrolments: 2, completed: 0, dropped: 0 },
    ];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'SUMMARY' },
        message: 'enrolments is 2, but its records add up to 1',
      }),
    ]);
  });

  it('reports a completed count for a status nobody has', () => {
    table.courseStats = [
      { courseId: 'c1', enrolments: 1, completed: 1, dropped: 0 },
    ];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'SUMMARY' },
        message: 'completed is 1, but its records add up to 0',
      }),
    ]);
  });

  it('expects a completed count for a completed enrolment', () => {
    table.enrolments[0].status = 'completed';
    expect(violations().map((v) => v.message)).toEqual([
      'completed is 0, but its records add up to 1',
    ]);
  });

  it('reports a missing summary for a course with enrolments', () => {
    table.courseStats = [];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'SUMMARY' },
        message: 'enrolments is 0, but its records add up to 1',
      }),
    ]);
  });

  it('reports a day with the wrong number of active learners', () => {
    table.periodStats[1].activeLearners = 2;
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'DAY#2026-01-02' },
        message: 'activeLearners is 2, but its records add up to 1',
      }),
    ]);
  });

  it('expects a lesson count for a student partway through it', () => {
    table.lessonStats = [];
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'LESSON#l1' },
        message: 'inProgress is 0, but its records add up to 1',
      }),
    ]);
  });

  it('reports a lesson counted as completed that nobody completed', () => {
    table.lessonStats = [
      { courseId: 'c1', lessonId: 'l1', inProgress: 1, completed: 1 },
    ];
    expect(violations().map((v) => v.message)).toEqual([
      'completed is 1, but its records add up to 0',
    ]);
  });

  it('moves a lesson count with the status, and ignores not_started', () => {
    table.progress[0].status = 'completed';
    expect(
      violations()
        .map((v) => v.message)
        .sort(),
    ).toEqual([
      'completed is 0, but its records add up to 1',
      'inProgress is 1, but its records add up to 0',
    ]);
    table.progress[0].status = 'not_started';
    expect(violations().map((v) => v.message)).toEqual([
      'inProgress is 1, but its records add up to 0',
    ]);
  });

  it('counts nothing in lessons for a dropped student', () => {
    table.enrolments[0].status = 'dropped';
    expect(violations().map((v) => v.record)).toContainEqual({
      courseId: 'c1',
      item: 'LESSON#l1',
    });
    table.lessonStats = [];
    expect(
      violations().filter(
        (v) => (v.record as { item: string }).item === 'LESSON#l1',
      ),
    ).toEqual([]);
  });

  it('expects a miss count for a question answered wrongly', () => {
    table.quizQuestionStats[1].misses = 0;
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'c1', item: 'QUIZ#quiz#Q#q2' },
        message: 'misses is 0, but its records add up to 1',
      }),
    ]);
  });

  it('reports an attempts count that is off for a question', () => {
    table.quizQuestionStats[0].attempts = 3;
    expect(violations().map((v) => v.message)).toEqual([
      'attempts is 3, but its records add up to 2',
    ]);
  });

  it('reports a missing item for a question that was answered', () => {
    table.quizQuestionStats = [];
    expect(violations().map((v) => v.record)).toEqual(
      expect.arrayContaining([
        { courseId: 'c1', item: 'QUIZ#quiz#Q#q1' },
        { courseId: 'c1', item: 'QUIZ#quiz#Q#q2' },
      ]),
    );
  });

  it('reports a student counted in the wrong score band', () => {
    table.quizScoreStats[0].band8 = 0;
    table.quizScoreStats[0].band4 = 1;
    expect(
      violations()
        .map((v) => v.message)
        .sort(),
    ).toEqual([
      'band4 is 1, but its records add up to 0',
      'band8 is 0, but its records add up to 1',
    ]);
  });

  it('moves a student’s band when their best score rises', () => {
    table.quizSummaries[0].bestScore = 100;
    expect(violations().map((v) => v.message)).toEqual(
      expect.arrayContaining([
        'band8 is 1, but its records add up to 0',
        'band9 is 0, but its records add up to 1',
      ]),
    );
  });

  it('reports aggregates for a course that has no records', () => {
    table.courseStats.push({
      courseId: 'gone',
      enrolments: 1,
      completed: 0,
      dropped: 0,
    });
    expect(violations()).toEqual([
      expect.objectContaining({
        record: { courseId: 'gone', item: 'SUMMARY' },
      }),
    ]);
  });
});
