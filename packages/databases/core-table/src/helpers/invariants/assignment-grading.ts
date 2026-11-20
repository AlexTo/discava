/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { FEEDBACK_MAX_LENGTH } from '../assignment-grading.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

const present = (value: unknown) => value !== undefined && value !== null;

type Submission = TableSnapshot['assignmentSubmissions'][number];
type Round = TableSnapshot['submissionFeedback'][number];

const submissionKey = (r: {
  courseId: string;
  contentItemId: string;
  userId: string;
}) => `${r.courseId} ${r.contentItemId} ${r.userId}`;

const keyOf = ({ userId, courseId, contentItemId }: Submission) => ({
  userId,
  courseId,
  contentItemId,
});

const GRADE_ATTRIBUTES = [
  'points',
  'pointsOutOf',
  'returnedAt',
  'returnedBy',
  'gradedAt',
] as const;

// A submission has a grade exactly when it is returned: points, pointsOutOf,
// returnedAt, returnedBy and gradedAt are all set, with 0 <= points <=
// pointsOutOf; any other status has none of them.
export const checkSubmissionGradeShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.assignmentSubmissions.flatMap((submission) => {
    const set = GRADE_ATTRIBUTES.filter((name) => present(submission[name]));
    const problems: string[] = [];
    if (submission.status === 'returned') {
      if (set.length !== GRADE_ATTRIBUTES.length) {
        const missing = GRADE_ATTRIBUTES.filter((name) => !set.includes(name));
        problems.push(`is returned without ${missing.join(', ')}`);
      } else if (
        !(submission.points! >= 0) ||
        !(submission.points! <= submission.pointsOutOf!)
      ) {
        problems.push(
          `points ${submission.points} is not from 0 to pointsOutOf ${submission.pointsOutOf}`,
        );
      }
    } else if (set.length > 0) {
      problems.push(`is ${submission.status} but has ${set.join(', ')}`);
    }
    return problems.map((message) =>
      violation('submission-grade-shape', keyOf(submission), message),
    );
  });

// A submission waits for an instructor, and is in the byWaiting index, exactly
// while it is `submitted`: waitingCourseId (its courseId) and waitingSince
// (its submittedAt) are set together, and only then.
export const checkSubmissionWaitingKeys = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.assignmentSubmissions.flatMap((submission) => {
    const { waitingCourseId, waitingSince } = submission;
    const problems: string[] = [];
    if (submission.status === 'submitted') {
      if (waitingCourseId !== submission.courseId) {
        problems.push(
          `is submitted but waitingCourseId is ${waitingCourseId ?? 'not set'}, not its course`,
        );
      }
      if (waitingSince !== submission.submittedAt) {
        problems.push(
          `is submitted but waitingSince is ${waitingSince ?? 'not set'}, not its submittedAt`,
        );
      }
    } else if (present(waitingCourseId) || present(waitingSince)) {
      problems.push(`is ${submission.status} but is still marked as waiting`);
    }
    return problems.map((message) =>
      violation('submission-waiting-keys', keyOf(submission), message),
    );
  });

// Every round of feedback belongs to an existing submission, and is about a
// version of it that exists.
export const checkSubmissionFeedbackHasSubmission = (
  snapshot: TableSnapshot,
): Violation[] => {
  const submissions = new Map(
    snapshot.assignmentSubmissions.map((s) => [submissionKey(s), s]),
  );
  return snapshot.submissionFeedback.flatMap((round) => {
    const record = {
      userId: round.userId,
      courseId: round.courseId,
      contentItemId: round.contentItemId,
      feedbackId: round.feedbackId,
    };
    const submission = submissions.get(submissionKey(round));
    if (!submission) {
      return [
        violation(
          'submission-feedback-has-submission',
          record,
          'feedback for a submission that does not exist',
        ),
      ];
    }
    return round.version <= submission.version
      ? []
      : [
          violation(
            'submission-feedback-has-submission',
            record,
            `is about version ${round.version}, but the submission is at version ${submission.version}`,
          ),
        ];
  });
};

// A resubmission request has non-empty feedback and no points; a return or an
// amendment has points from 0 to pointsOutOf. Feedback is within its limit,
// and a round says who gave it and when.
export const checkSubmissionFeedbackShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.submissionFeedback.flatMap((round) => {
    const problems: string[] = [];
    if (round.kind === 'resubmission_requested') {
      if (!round.feedback || round.feedback.trim() === '') {
        problems.push('a resubmission request has no feedback');
      }
      if (present(round.points) || present(round.pointsOutOf)) {
        problems.push('a resubmission request has points');
      }
    } else if (round.kind === 'returned' || round.kind === 'amended') {
      if (
        !present(round.points) ||
        !present(round.pointsOutOf) ||
        !(round.points! >= 0) ||
        !(round.points! <= round.pointsOutOf!)
      ) {
        problems.push(
          `points ${round.points} is not from 0 to pointsOutOf ${round.pointsOutOf}`,
        );
      }
    } else {
      problems.push(`kind ${round.kind} is not known`);
    }
    if (
      round.feedback !== undefined &&
      round.feedback.length > FEEDBACK_MAX_LENGTH
    ) {
      problems.push(`feedback is over ${FEEDBACK_MAX_LENGTH} characters`);
    }
    if (!round.givenBy || !round.givenAt) {
      problems.push('givenBy or givenAt is not set');
    }
    return problems.map((message) =>
      violation(
        'submission-feedback-shape',
        {
          userId: round.userId,
          courseId: round.courseId,
          contentItemId: round.contentItemId,
          feedbackId: round.feedbackId,
        },
        message,
      ),
    );
  });

const newestFirst = (a: Round, b: Round) =>
  b.givenAt === a.givenAt
    ? b.feedbackId.localeCompare(a.feedbackId)
    : b.givenAt.localeCompare(a.givenAt);

// The submission's status and grade agree with its rounds: a requested
// resubmission has a request for its current version as its newest round; a
// returned one has a return or amendment as its newest, with its points; and
// reviewRevision counts the rounds (every instructor action adds one).
export const checkSubmissionLatestRoundMatches = (
  snapshot: TableSnapshot,
): Violation[] => {
  const rounds = new Map<string, Round[]>();
  for (const round of snapshot.submissionFeedback) {
    rounds.set(submissionKey(round), [
      ...(rounds.get(submissionKey(round)) ?? []),
      round,
    ]);
  }
  return snapshot.assignmentSubmissions.flatMap((submission) => {
    const own = (rounds.get(submissionKey(submission)) ?? []).sort(newestFirst);
    const newest = own[0];
    const problems: string[] = [];
    if (submission.reviewRevision !== own.length) {
      problems.push(
        `reviewRevision is ${submission.reviewRevision}, but it has ${own.length} rounds of feedback`,
      );
    }
    if (submission.status === 'resubmission_requested') {
      if (newest?.kind !== 'resubmission_requested') {
        problems.push('a resubmission was requested, but no round says so');
      } else if (newest.version !== submission.version) {
        problems.push(
          `the request is for version ${newest.version}, but the submission is at version ${submission.version}`,
        );
      }
    } else if (submission.status === 'returned') {
      if (newest?.kind !== 'returned' && newest?.kind !== 'amended') {
        problems.push('it is returned, but its newest round is not a return');
      } else if (
        newest.points !== submission.points ||
        newest.pointsOutOf !== submission.pointsOutOf
      ) {
        problems.push(
          `its newest round grades ${newest.points}/${newest.pointsOutOf}, but the submission has ${submission.points}/${submission.pointsOutOf}`,
        );
      }
    }
    return problems.map((message) =>
      violation('submission-latest-round-matches', keyOf(submission), message),
    );
  });
};

const DAY_SECONDS = 24 * 60 * 60;

// A daily instructor notice marker is for a real UTC day (YYYY-MM-DD) and
// expires, by its ttl in epoch seconds, two days after that day starts.
export const checkSubmissionNoticeShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.submissionNotices.flatMap((notice) => {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(notice.day)
      ? Date.parse(`${notice.day}T00:00:00.000Z`) / 1000
      : Number.NaN;
    const problems: string[] = [];
    if (Number.isNaN(start)) {
      problems.push(`day ${notice.day} is not a YYYY-MM-DD date`);
    } else if (notice.ttl !== start + 2 * DAY_SECONDS) {
      problems.push(`ttl ${notice.ttl} is not two days after ${notice.day}`);
    }
    return problems.map((message) =>
      violation(
        'submission-notice-shape',
        {
          courseId: notice.courseId,
          contentItemId: notice.contentItemId,
          day: notice.day,
        },
        message,
      ),
    );
  });

export const ASSIGNMENT_GRADING_CHECKS = [
  { name: 'submission-grade-shape', check: checkSubmissionGradeShape },
  { name: 'submission-waiting-keys', check: checkSubmissionWaitingKeys },
  {
    name: 'submission-feedback-has-submission',
    check: checkSubmissionFeedbackHasSubmission,
  },
  { name: 'submission-feedback-shape', check: checkSubmissionFeedbackShape },
  {
    name: 'submission-latest-round-matches',
    check: checkSubmissionLatestRoundMatches,
  },
  { name: 'submission-notice-shape', check: checkSubmissionNoticeShape },
] as const satisfies readonly Check[];
