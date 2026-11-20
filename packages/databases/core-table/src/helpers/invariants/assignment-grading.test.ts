/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import {
  checkTableInvariants,
  consistentTable,
  ids,
  prefix,
} from './test-fixture.js';

const INVARIANTS_UNDER_TEST: InvariantName[] = [
  'submission-grade-shape',
  'submission-waiting-keys',
  'submission-feedback-has-submission',
  'submission-feedback-shape',
  'submission-latest-round-matches',
  'submission-notice-shape',
  'assignment-submission-shape',
];

const SUBMITTED = '2026-01-02T09:30:00.000Z';
const REQUESTED = '2026-01-03T09:00:00.000Z';
const RETURNED = '2026-01-05T09:00:00.000Z';
const folder = `${prefix}/video/submissions/student/a1/`;

let table: TableSnapshot;

// The consistent table, with its video item turned into an upload assignment
// the student submitted to, was asked to resubmit (version 1), resubmitted
// (version 2) and then had returned with 8 of 10: two rounds, as the grading
// writes leave them.
const returnedTable = (): TableSnapshot => {
  const t = consistentTable();
  const upload = t.contentItems.find((i) => i.contentItemId === 'video')!;
  upload.type = 'assignment';
  upload.s3Key = undefined;
  upload.studentActivityCount = 1;
  t.itemCompletions.push({
    ...ids,
    userId: 'student',
    contentItemId: 'video',
    completedAt: SUBMITTED,
  });
  const key = {
    courseId: 'c1',
    contentItemId: 'video',
    userId: 'student',
  };
  t.assignmentSubmissions.push({
    ...ids,
    ...key,
    file: {
      key: `${folder}work.pdf`,
      fileName: 'work.pdf',
      fileSize: 10,
      mimeType: 'application/pdf',
    },
    status: 'returned',
    version: 2,
    reviewRevision: 2,
    submittedAt: SUBMITTED,
    points: 8,
    pointsOutOf: 10,
    returnedAt: RETURNED,
    returnedBy: 'teacher',
    gradedAt: RETURNED,
  });
  t.submissionFeedback.push(
    {
      ...key,
      feedbackId: 'f1',
      kind: 'resubmission_requested',
      feedback: '{"type":"doc"}',
      version: 1,
      givenAt: REQUESTED,
      givenBy: 'teacher',
    },
    {
      ...key,
      feedbackId: 'f2',
      kind: 'returned',
      points: 8,
      pointsOutOf: 10,
      version: 2,
      givenAt: RETURNED,
      givenBy: 'teacher',
    },
  );
  return t;
};

beforeEach(() => {
  table = returnedTable();
});

const submission = () => table.assignmentSubmissions[0]!;
const violationsOf = (invariant: InvariantName) =>
  checkTableInvariants(table).filter((v) => v.invariant === invariant);

describe('submission-notice-shape', () => {
  const notice = {
    courseId: 'c1',
    contentItemId: 'video',
    day: '2026-01-02',
    ttl: Date.parse('2026-01-04T00:00:00.000Z') / 1000,
  };

  it('keeps a marker that expires two days after its day', () => {
    table.submissionNotices.push(notice);
    expect(violationsOf('submission-notice-shape')).toEqual([]);
  });

  it('reports a ttl that is not two days after the day', () => {
    table.submissionNotices.push({ ...notice, ttl: notice.ttl + 1 });
    expect(violationsOf('submission-notice-shape')[0]?.message).toMatch(
      /not two days after 2026-01-02/,
    );
  });

  it.each(['2026-1-2', 'yesterday', '2026-13-45'])(
    'reports the day %s',
    (day) => {
      table.submissionNotices.push({ ...notice, day });
      expect(violationsOf('submission-notice-shape')[0]?.message).toMatch(
        /not a YYYY-MM-DD date/,
      );
    },
  );
});

describe('grading (#102)', () => {
  it.each(INVARIANTS_UNDER_TEST)(
    'keeps %s for a returned submission',
    (name) => {
      expect(violationsOf(name)).toEqual([]);
    },
  );

  it('keeps the grading invariants for a submission waiting after a request', () => {
    // Resubmitted at version 2 after the request: submitted, and waiting.
    Object.assign(submission(), {
      status: 'submitted',
      reviewRevision: 1,
      waitingCourseId: 'c1',
      waitingSince: SUBMITTED,
      points: undefined,
      pointsOutOf: undefined,
      returnedAt: undefined,
      returnedBy: undefined,
      gradedAt: undefined,
    });
    table.submissionFeedback.pop();

    for (const name of INVARIANTS_UNDER_TEST) {
      expect(violationsOf(name)).toEqual([]);
    }
  });

  describe('submission-grade-shape', () => {
    it.each(['points', 'pointsOutOf', 'returnedAt', 'returnedBy', 'gradedAt'])(
      'reports a returned submission without %s',
      (name) => {
        (submission() as Record<string, unknown>)[name] = undefined;
        expect(violationsOf('submission-grade-shape')[0]?.message).toMatch(
          new RegExp(`without .*${name}`),
        );
      },
    );

    it.each([-1, 11])('reports points of %s out of 10', (points) => {
      submission().points = points;
      expect(violationsOf('submission-grade-shape')[0]?.message).toMatch(
        /not from 0 to pointsOutOf 10/,
      );
    });

    it('reports a grade on a submission that is not returned', () => {
      submission().status = 'submitted';
      submission().waitingCourseId = 'c1';
      submission().waitingSince = SUBMITTED;
      expect(violationsOf('submission-grade-shape')[0]?.message).toMatch(
        /is submitted but has points/,
      );
    });
  });

  describe('submission-waiting-keys', () => {
    it('reports a returned submission still marked as waiting', () => {
      submission().waitingCourseId = 'c1';
      submission().waitingSince = SUBMITTED;
      expect(violationsOf('submission-waiting-keys')[0]?.message).toMatch(
        /still marked as waiting/,
      );
    });

    it('reports a requested resubmission still marked as waiting', () => {
      submission().status = 'resubmission_requested';
      submission().waitingSince = SUBMITTED;
      expect(violationsOf('submission-waiting-keys')).toHaveLength(1);
    });

    it('reports a submitted submission that is not waiting', () => {
      Object.assign(submission(), { status: 'submitted' });
      expect(violationsOf('submission-waiting-keys')).toHaveLength(2);
    });

    it('reports a waiting time other than the submission time', () => {
      Object.assign(submission(), {
        status: 'submitted',
        waitingCourseId: 'c1',
        waitingSince: '2026-01-01T00:00:00.000Z',
      });
      expect(violationsOf('submission-waiting-keys')[0]?.message).toMatch(
        /waitingSince is 2026-01-01/,
      );
    });

    it('reports another course in waitingCourseId', () => {
      Object.assign(submission(), {
        status: 'submitted',
        waitingCourseId: 'other',
        waitingSince: SUBMITTED,
      });
      expect(violationsOf('submission-waiting-keys')[0]?.message).toMatch(
        /waitingCourseId is other/,
      );
    });
  });

  describe('submission-feedback-has-submission', () => {
    it('reports a round whose submission is gone', () => {
      table.assignmentSubmissions = [];
      expect(violationsOf('submission-feedback-has-submission')).toHaveLength(
        2,
      );
    });

    it('reports a round about a version the submission has not reached', () => {
      submission().version = 1;
      expect(
        violationsOf('submission-feedback-has-submission')[0]?.message,
      ).toMatch(/about version 2/);
    });
  });

  describe('submission-feedback-shape', () => {
    it('reports a request without feedback', () => {
      table.submissionFeedback[0]!.feedback = ' ';
      expect(violationsOf('submission-feedback-shape')[0]?.message).toMatch(
        /no feedback/,
      );
    });

    it('reports a request with points', () => {
      table.submissionFeedback[0]!.points = 3;
      expect(violationsOf('submission-feedback-shape')[0]?.message).toMatch(
        /has points/,
      );
    });

    it.each([-1, 11, undefined])(
      'reports a return with points %s',
      (points) => {
        table.submissionFeedback[1]!.points = points;
        expect(violationsOf('submission-feedback-shape')[0]?.message).toMatch(
          /not from 0 to pointsOutOf/,
        );
      },
    );

    it('reports feedback over the limit', () => {
      table.submissionFeedback[1]!.feedback = 'x'.repeat(20_001);
      expect(violationsOf('submission-feedback-shape')[0]?.message).toMatch(
        /over 20000/,
      );
    });

    it('reports a round with no giver', () => {
      table.submissionFeedback[1]!.givenBy = '';
      expect(violationsOf('submission-feedback-shape')).toHaveLength(1);
    });
  });

  describe('submission-latest-round-matches', () => {
    it('reports a revision that is not the number of rounds', () => {
      submission().reviewRevision = 3;
      expect(
        violationsOf('submission-latest-round-matches')[0]?.message,
      ).toMatch(/reviewRevision is 3, but it has 2 rounds/);
    });

    it('reports a returned submission whose newest round is a request', () => {
      table.submissionFeedback.pop();
      submission().reviewRevision = 1;
      expect(
        violationsOf('submission-latest-round-matches')[0]?.message,
      ).toMatch(/newest round is not a return/);
    });

    it('reports a grade the newest round does not match', () => {
      submission().points = 9;
      expect(
        violationsOf('submission-latest-round-matches')[0]?.message,
      ).toMatch(/grades 8\/10, but the submission has 9\/10/);
    });

    it('accepts an amendment as the newest round', () => {
      submission().points = 9;
      submission().reviewRevision = 3;
      table.submissionFeedback.push({
        ...table.submissionFeedback[1]!,
        feedbackId: 'f3',
        kind: 'amended',
        points: 9,
        givenAt: '2026-01-06T09:00:00.000Z',
      });
      expect(violationsOf('submission-latest-round-matches')).toEqual([]);
    });

    it('reports a requested resubmission without a request round', () => {
      Object.assign(submission(), {
        status: 'resubmission_requested',
        points: undefined,
        pointsOutOf: undefined,
        returnedAt: undefined,
        returnedBy: undefined,
        gradedAt: undefined,
      });
      expect(
        violationsOf('submission-latest-round-matches')[0]?.message,
      ).toMatch(/no round says so/);
    });

    it('reports a request for another version than the current one', () => {
      Object.assign(submission(), {
        status: 'resubmission_requested',
        reviewRevision: 1,
        version: 2,
        points: undefined,
        pointsOutOf: undefined,
        returnedAt: undefined,
        returnedBy: undefined,
        gradedAt: undefined,
      });
      table.submissionFeedback.pop();
      expect(
        violationsOf('submission-latest-round-matches')[0]?.message,
      ).toMatch(/request is for version 1/);
    });
  });
});
