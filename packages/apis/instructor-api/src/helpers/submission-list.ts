/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ISubmissionCounts, ISubmissionRow } from '../schema/index.js';

// The grading list of one upload assignment (specs/20261120-230057-
// assignment-grading, research R-4): the course's students merged with their
// submissions, in the order an instructor works through them, in pages of
// PAGE_SIZE. A pure function over what the procedure read.

export const PAGE_SIZE = 50;

export interface ListedEnrolment {
  userId: string;
  status: 'active' | 'completed' | 'dropped';
}

export interface ListedSubmission {
  userId: string;
  status: 'submitted' | 'resubmission_requested' | 'returned';
  submittedAt: string;
  version: number;
  late: boolean;
  points?: number;
  pointsOutOf?: number;
}

/** A row before its student's name is read, which only the page needs. */
export type UnnamedRow = Omit<ISubmissionRow, 'displayName'>;

// The order: submitted work of enrolled students (the longest waiting first),
// then requested resubmissions, returned work, students with nothing
// submitted, and last the work of students who left.
const GROUP = {
  submitted: 0,
  resubmission_requested: 1,
  returned: 2,
  not_submitted: 3,
  not_enrolled: 4,
} as const;

type SortTuple = [group: number, submittedAt: string, userId: string];

const tupleOf = (row: UnnamedRow): SortTuple => [
  row.enrolled ? GROUP[row.state] : GROUP.not_enrolled,
  row.submittedAt ?? '',
  row.userId,
];

const compare = (a: SortTuple, b: SortTuple): number => {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
};

export const encodeCursor = (tuple: SortTuple): string =>
  Buffer.from(JSON.stringify(tuple)).toString('base64url');

/** The tuple a cursor holds, or undefined when it isn't one of ours. */
export const decodeCursor = (cursor: string): SortTuple | undefined => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
      ? (value as SortTuple)
      : undefined;
  } catch {
    return undefined;
  }
};

export interface SubmissionList {
  counts: ISubmissionCounts;
  rows: UnnamedRow[];
  nextCursor?: string;
}

/**
 * Lists the students of an assignment: the course's enrolments (any status
 * but dropped), and dropped students (or ones with no enrolment) who have a
 * submission, last and read-only. `counts` cover the whole assignment, and
 * leave students who left out of `waiting`. A cursor continues after the
 * tuple of the last row of the previous page, so a row before it changing
 * state doesn't move the page boundary.
 */
export const submissionList = (
  enrolments: ListedEnrolment[],
  submissions: ListedSubmission[],
  cursor?: string,
): SubmissionList => {
  const enrolled = new Set(
    enrolments.filter((e) => e.status !== 'dropped').map((e) => e.userId),
  );
  const submitted = new Map(submissions.map((s) => [s.userId, s]));

  const rows: UnnamedRow[] = [];
  for (const userId of enrolled) {
    const submission = submitted.get(userId);
    rows.push(
      submission
        ? rowOf(submission, true)
        : { userId, enrolled: true, state: 'not_submitted' },
    );
  }
  for (const submission of submissions) {
    if (!enrolled.has(submission.userId)) {
      rows.push(rowOf(submission, false));
    }
  }
  rows.sort((a, b) => compare(tupleOf(a), tupleOf(b)));

  const counts: ISubmissionCounts = {
    waiting: 0,
    resubmissionRequested: 0,
    returned: 0,
    notSubmitted: 0,
  };
  for (const row of rows) {
    if (row.state === 'submitted' && row.enrolled) counts.waiting++;
    else if (row.state === 'resubmission_requested') {
      counts.resubmissionRequested++;
    } else if (row.state === 'returned') counts.returned++;
    else if (row.state === 'not_submitted') counts.notSubmitted++;
  }

  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  const remaining = after
    ? rows.filter((row) => compare(tupleOf(row), after) > 0)
    : rows;
  const page = remaining.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    counts,
    rows: page,
    ...(remaining.length > PAGE_SIZE && last
      ? { nextCursor: encodeCursor(tupleOf(last)) }
      : {}),
  };
};

const rowOf = (
  submission: ListedSubmission,
  enrolled: boolean,
): UnnamedRow => ({
  userId: submission.userId,
  enrolled,
  state: submission.status,
  late: submission.late,
  submittedAt: submission.submittedAt,
  version: submission.version,
  ...(submission.points === undefined ? {} : { points: submission.points }),
  ...(submission.pointsOutOf === undefined
    ? {}
    : { pointsOutOf: submission.pointsOutOf }),
});
