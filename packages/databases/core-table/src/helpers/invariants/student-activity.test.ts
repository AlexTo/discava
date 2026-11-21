/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import {
  AT,
  checkTableInvariants,
  consistentTable,
  ids,
  T,
  testHelpers,
} from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { item, broken, expectOnly } = testHelpers(() => table);

describe('activity-count-matches-students', () => {
  it('reports a count lower than the students with completions', () => {
    item('text').studentActivityCount = 0;
    expectOnly('activity-count-matches-students', /0, but 1 students/);
  });

  it('reports a count higher than the students with records', () => {
    item('file').studentActivityCount = 1;
    expectOnly('activity-count-matches-students', /1, but 0 students/);
  });

  it('counts a student once, whatever records they have', () => {
    // The quiz's student has both a completion and a summary.
    expect(item('quiz').studentActivityCount).toBe(1);
    expect(broken().invariants).toEqual([]);
  });

  it('counts a quiz attempted but not yet completed', () => {
    table.itemCompletions = table.itemCompletions.filter(
      (c) => c.contentItemId !== 'quiz',
    );
    table.enrolments[0].progressPercent = 25;
    expect(broken().invariants).toEqual([]);
  });
});

describe('quiz-summary-matches-attempts', () => {
  it('reports attemptsUsed that is not the number of attempts', () => {
    table.quizSummaries[0].attemptsUsed = 3;
    expectOnly('quiz-summary-matches-attempts', /3, but there are 2/);
  });

  it('reports a bestScore that is not the best attempt', () => {
    table.quizSummaries[0].bestScore = 40;
    expectOnly('quiz-summary-matches-attempts', /the best attempt scored 80/);
  });

  it('reports a bestAttemptId that does not score bestScore', () => {
    table.quizSummaries[0].bestAttemptId = 'a1';
    expectOnly('quiz-summary-matches-attempts', /bestAttemptId a1/);
  });

  it('reports a pass without passedAt, and passedAt without a pass', () => {
    table.quizSummaries[0].passedAt = undefined;
    expectOnly('quiz-summary-matches-attempts', /passedAt is not set/);

    table = consistentTable();
    table.quizAttempts[1].passed = false;
    expectOnly('quiz-summary-matches-attempts', /no attempt passed/);
  });

  it('reports an attempt with no summary', () => {
    // Another enrolled student, whose attempt never got its summary.
    table.enrolments.push({
      courseId: 'c1',
      userId: 'classmate',
      status: 'active',
      progressPercent: 0,
      lastActivityAt: AT.a1,
    });
    table.quizAttempts.push({
      ...ids,
      userId: 'classmate',
      contentItemId: 'quiz',
      attemptId: 'a9',
      scorePercent: 10,
      passed: false,
      submittedAt: AT.a1,
    });
    const { violations } = broken();
    expect(violations).toContainEqual(
      expect.objectContaining({
        invariant: 'quiz-summary-matches-attempts',
        message: 'attempt has no quizSummary',
        record: expect.objectContaining({ attemptId: 'a9' }),
      }),
    );
  });
});

describe('progress-matches-completions', () => {
  it('reports a progressPercent the completions do not give', () => {
    table.enrolments[0].progressPercent = 75;
    expectOnly('progress-matches-completions', /75, but should be 50/);
  });

  it('reports lesson progress the completions do not give', () => {
    table.progress[0].status = 'not_started';
    expectOnly(
      'progress-matches-completions',
      /not_started, but should be in_progress/,
    );
  });

  it('treats a lesson with no progress record as not started', () => {
    table.progress = [];
    expectOnly(
      'progress-matches-completions',
      /not_started, but should be in_progress/,
    );
  });

  it('reports an enrolment not completed when every item is', () => {
    for (const contentItemId of ['video', 'file']) {
      table.itemCompletions.push({
        ...ids,
        userId: 'student',
        contentItemId,
        completedAt: AT.text,
      });
      item(contentItemId).studentActivityCount = 1;
    }
    table.enrolments[0].progressPercent = 100;
    table.progress[0] = {
      ...table.progress[0],
      status: 'completed',
      completedAt: T,
    };
    expectOnly('progress-matches-completions', /the enrolment is active/);
  });

  it('accepts completion that stays after new content is added', () => {
    table.progress[0] = {
      ...table.progress[0],
      status: 'completed',
      completedAt: T,
    };
    table.enrolments[0] = {
      ...table.enrolments[0],
      status: 'completed',
      completedAt: T,
    };
    expect(broken().invariants).toEqual([]);
  });

  it('counts only what students can see', () => {
    // Hiding the video and file leaves the two completed items: 100%.
    item('video').visibility = 'hidden';
    item('file').archivedAt = T;
    expectOnly('progress-matches-completions', /50, but should be 100/);
  });

  it('leaves dropped enrolments alone', () => {
    table.enrolments[0] = {
      ...table.enrolments[0],
      status: 'dropped',
      progressPercent: 0,
    };
    expect(broken().invariants).toEqual([]);
  });
});

describe('completed-at-iff-completed', () => {
  it('reports completedAt without completed, on progress and enrolments', () => {
    table.progress[0].completedAt = T;
    expectOnly('completed-at-iff-completed', /the status is in_progress/);

    table = consistentTable();
    table.enrolments[0].completedAt = T;
    expectOnly('completed-at-iff-completed', /the status is active/);
  });

  it('reports completed without completedAt', () => {
    table.enrolments[0].status = 'completed';
    expectOnly('completed-at-iff-completed', /completedAt is not set/);
  });

  // A refund ends a completed enrolment without clearing the date.
  it('accepts a dropped enrolment with or without completedAt', () => {
    table.enrolments[0].status = 'dropped';
    table.enrolments[0].completedAt = T;
    expect(broken().invariants).not.toContain('completed-at-iff-completed');
    table.enrolments[0].completedAt = undefined;
    expect(broken().invariants).not.toContain('completed-at-iff-completed');
  });

  it('still reports an active enrolment with completedAt', () => {
    table.enrolments[0].completedAt = T;
    expectOnly('completed-at-iff-completed', /the status is active/);
  });
});

describe('student-records-have-targets', () => {
  it('reports an enrolment in a course that does not exist', () => {
    table.enrolments.push({
      courseId: 'gone',
      userId: 'student',
      status: 'active',
      progressPercent: 0,
    });
    expectOnly('student-records-have-targets', /enrolment/);
  });

  it('reports quiz records for something that is not a quiz', () => {
    item('quiz').type = 'text';
    expectOnly('student-records-have-targets', /quiz summary for a text item/);
  });

  it('reports a completion whose item was deleted', () => {
    table.itemCompletions.push({
      ...ids,
      userId: 'student',
      contentItemId: 'deleted',
      completedAt: AT.text,
    });
    expectOnly(
      'student-records-have-targets',
      /completion for a content item that does not exist/,
    );
  });
});

describe('student-records-enrolled', () => {
  it('reports completions and quiz records with no enrolment', () => {
    table.enrolments = [];
    const { invariants, violations } = broken();
    expect(invariants).toEqual(['student-records-enrolled']);
    // Two completions, two attempts, a summary and a video answer sheet.
    expect(violations).toHaveLength(6);
  });

  it('still counts a dropped enrolment', () => {
    table.enrolments[0].status = 'dropped';
    expect(broken().invariants).toEqual([]);
  });
});

describe('enrolment-in-published-course', () => {
  it('reports an enrolment in a course never published', () => {
    // A draft course: it has never been published.
    table.courses[0] = {
      ...table.courses[0],
      status: 'draft',
      publishedAt: undefined,
    };
    expect(broken().invariants).toContain('enrolment-in-published-course');
  });

  it('accepts an enrolment in a course archived after publishing', () => {
    table.courses[0].status = 'archived';
    expect(broken().invariants).toEqual([]);
  });
});

describe('student-records-placed-with-item', () => {
  it("reports a record filed under a lesson that isn't its item's", () => {
    table.itemCompletions[0].lessonId = 'l9';
    expectOnly(
      'student-records-placed-with-item',
      /lesson l9, but the item is in module m1, lesson l1/,
    );
  });
});

describe('last-activity-at-current', () => {
  it('reports a lastActivityAt older than the latest activity', () => {
    table.enrolments[0].lastActivityAt = AT.a1;
    expectOnly('last-activity-at-current', /latest activity was at/);
  });

  it('reports a missing lastActivityAt when there was activity', () => {
    table.enrolments[0].lastActivityAt = undefined;
    expectOnly('last-activity-at-current', /not set/);
  });
});

describe('video answer sheets', () => {
  const sheet = () => table.videoAnswerSheets[0];

  it('counts a student with only a sheet', () => {
    item('video').studentActivityCount = 0;
    expectOnly('activity-count-matches-students', /0, but 1 students/);
  });

  it('counts a student with a sheet and a completion once', () => {
    table.itemCompletions.push({
      ...ids,
      userId: 'student',
      contentItemId: 'video',
      completedAt: AT.a2,
    });
    table.enrolments[0].progressPercent = 75;
    expect(broken().invariants).toEqual([]);
  });

  it('reports a sheet for an item that does not exist', () => {
    sheet().contentItemId = 'gone';
    expect(broken().invariants).toContain('student-records-have-targets');
  });

  it('reports a sheet by a student not enrolled', () => {
    table.enrolments = [];
    expect(broken().invariants).toContain('student-records-enrolled');
  });

  it('reports a sheet filed under another lesson', () => {
    sheet().lessonId = 'elsewhere';
    expectOnly('student-records-placed-with-item');
  });

  it("reports an answer later than the enrolment's last activity", () => {
    sheet().answers.q1.answeredAt = '2026-01-03T00:00:00.000Z';
    expectOnly('last-activity-at-current', /latest activity was at 2026-01-03/);
  });
});

describe('video-answer-sheet-shape', () => {
  const sheet = () => table.videoAnswerSheets[0];
  const entry = () => sheet().answers.q1;
  const reported = () => {
    table.quizQuestionStats = []; // the aggregates are not the point here
    return checkTableInvariants(table).filter(
      (v) => v.invariant === 'video-answer-sheet-shape',
    );
  };

  it('accepts the consistent sheet', () => {
    expect(reported()).toEqual([]);
  });

  it('reports a sheet on an item that is not a video', () => {
    sheet().contentItemId = 'text';
    expect(reported().map((v) => v.message)).toContain(
      'answers to a text item',
    );
  });

  it('reports an answerCount that is not the number of entries', () => {
    sheet().answerCount = 2;
    expect(reported().map((v) => v.message)).toEqual([
      'answerCount is 2, but there are 1 entries',
    ]);
  });

  it.each([
    ['no options', { optionIds: [] }],
    ['a correct flag that is not a boolean', { correct: 'yes' }],
    ['an invalid answeredAt', { answeredAt: 'yesterday' }],
    ['a quizVersion of 0', { quizVersion: 0 }],
    ["a quizVersion beyond the item's", { quizVersion: 3 }],
  ])('reports an entry with %s', (_, change) => {
    sheet().answers.q1 = { ...entry(), ...change };
    expect(reported()).toHaveLength(1);
  });
});

describe('video-position-valid', () => {
  const violationsOf = (invariant: InvariantName) =>
    checkTableInvariants(table).filter((v) => v.invariant === invariant);

  const position = () => ({
    userId: 'student',
    courseId: 'c1',
    lessonId: 'l1',
    contentItemId: 'video',
    positionSeconds: 42,
    versionId: 'nonce-1',
  });

  it('accepts a valid position, and 0', () => {
    table.videoPositions.push(position(), {
      ...position(),
      contentItemId: 'video-2',
      positionSeconds: 0,
    });
    expect(violationsOf('video-position-valid')).toEqual([]);
  });

  it.each([
    ['a negative position', { positionSeconds: -1 }],
    ['a fractional position', { positionSeconds: 1.5 }],
    ['a position over the cap', { positionSeconds: 86_401 }],
    ['a missing versionId', { versionId: '' }],
  ])('reports %s', (_, change) => {
    table.videoPositions.push({ ...position(), ...change });
    expect(violationsOf('video-position-valid')).toHaveLength(1);
  });

  // A position is not a student record (research R-6): it may outlive its
  // item, and its student needs no activity count.
  it('is not a student record: an orphan position trips no other check', () => {
    table.users.push({ userId: 'someone' });
    table.videoPositions.push({
      ...position(),
      userId: 'someone',
      contentItemId: 'deleted-video',
    });
    expect(checkTableInvariants(table)).toEqual([]);
  });
});
