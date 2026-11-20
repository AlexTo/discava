/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import {
  type NotificationTransactionItems,
  notificationWrites,
  transactionEntities,
} from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// An instructor's grading of a student's upload submission (#102). Every
// writer builds its transaction from the functions here, so the rules that
// span records are kept in one place:
// - the submission only changes from the version and review revision the
//   instructor read, and only from a state the action is allowed in;
// - the round of feedback and the student's notification are written in the
//   same transaction as the submission, so none exists without the others;
// - the status and the byWaiting index agree (waitingKeys);
// - nothing here touches the student's completion or the item's
//   studentActivityCount: grading is not student activity.
// The functions run no writes of their own: a failed condition cancels the
// transaction and the caller reads again and decides.

export const FEEDBACK_MAX_LENGTH = 20_000;

const TRANSACTION_ITEMS = 100;
// The marker's create, and the 2 items of each instructor's notification
// (the notification and the user's unread count), within the submission's
// transaction of 8 items (data-model, Transaction contents).
const SUBMISSION_ITEMS = 8;
export const MAX_SUBMISSION_NOTICE_INSTRUCTORS = Math.floor(
  (TRANSACTION_ITEMS - SUBMISSION_ITEMS) / 2,
);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether `points` is a grade for an assignment worth `maxPoints`. */
export const isValidPoints = (points: unknown, maxPoints: number): boolean =>
  typeof points === 'number' &&
  Number.isFinite(points) &&
  points >= 0 &&
  points <= maxPoints &&
  Math.abs(Math.round(points * 100) - points * 100) < 1e-6;

export type WaitingKeys =
  | { waitingCourseId: string; waitingSince: string }
  | { remove: ['waitingCourseId', 'waitingSince'] };

/**
 * The byWaiting attributes a submission in `status` has: both while it is
 * submitted (waiting for an instructor), otherwise the two names to remove.
 */
export const waitingKeys = (
  status: 'submitted' | 'resubmission_requested' | 'returned',
  courseId: string,
  submittedAt: string,
): WaitingKeys =>
  status === 'submitted'
    ? { waitingCourseId: courseId, waitingSince: submittedAt }
    : { remove: ['waitingCourseId', 'waitingSince'] };

export interface SubmissionKey {
  courseId: string;
  contentItemId: string;
  userId: string;
}

interface RoundInput {
  /** A new ULID for the round, also the notification's dedupe key. */
  feedbackId: string;
  /** The instructor, and when. */
  givenBy: string;
  givenAt: string;
  /** Tiptap JSON as a string, at most FEEDBACK_MAX_LENGTH characters. */
  feedback?: string;
  /** What the student's notification names. */
  lessonId: string;
  assignmentTitle: string;
  courseTitle: string;
}

export interface ReturnSubmissionWrite extends SubmissionKey, RoundInput {
  /** The submission as the instructor read it. */
  version: number;
  reviewRevision: number;
  points: number;
  /** The assignment's maxPoints. */
  pointsOutOf: number;
}

export interface RequestResubmissionWrite extends SubmissionKey, RoundInput {
  version: number;
  reviewRevision: number;
  /** Required: what the student should change. */
  feedback: string;
}

export interface AmendGradeWrite extends SubmissionKey, RoundInput {
  /** The submission's current version, recorded on the round. */
  version: number;
  reviewRevision: number;
  points: number;
  pointsOutOf: number;
}

const studentNotification = (
  type:
    | 'assignment.returned'
    | 'assignment.resubmission_requested'
    | 'assignment.grade_updated',
  write: SubmissionKey & RoundInput,
) => ({
  type,
  userId: write.userId,
  params: {
    courseId: write.courseId,
    lessonId: write.lessonId,
    assignmentTitle: write.assignmentTitle,
    courseTitle: write.courseTitle,
  },
  dedupeKey: write.feedbackId,
  occurredAt: write.givenAt,
});

const requireFeedback = (feedback: string | undefined) => {
  if (feedback === undefined || feedback.trim() === '') {
    throw new RangeError('A resubmission request needs feedback');
  }
};

const checkFeedbackLength = (feedback: string | undefined) => {
  if (feedback !== undefined && feedback.length > FEEDBACK_MAX_LENGTH) {
    throw new RangeError(`feedback is over ${FEEDBACK_MAX_LENGTH} characters`);
  }
};

/**
 * Returns a submission as final, with points and optional feedback: 4 items
 * (the submission, the round, the student's notification and unread count).
 * The submission must be `submitted` or `resubmission_requested`, at the
 * version and review revision the instructor read.
 */
export const returnSubmissionWrites = async (
  service: CoreTable,
  write: ReturnSubmissionWrite,
): Promise<NotificationTransactionItems> => {
  checkFeedbackLength(write.feedback);
  const { assignmentSubmission, submissionFeedback } =
    transactionEntities(service);
  const { courseId, contentItemId, userId, version, reviewRevision } = write;
  return [
    assignmentSubmission
      .patch({ courseId, contentItemId, userId })
      .set({
        status: 'returned',
        points: write.points,
        pointsOutOf: write.pointsOutOf,
        returnedAt: write.givenAt,
        returnedBy: write.givenBy,
        gradedAt: write.givenAt,
        reviewRevision: reviewRevision + 1,
      })
      .remove(['waitingCourseId', 'waitingSince'])
      .where(
        (attr, op) =>
          `${op.eq(attr.version, version)} AND ${op.eq(attr.reviewRevision, reviewRevision)} AND (${op.eq(attr.status, 'submitted')} OR ${op.eq(attr.status, 'resubmission_requested')})`,
      )
      .commit(),
    submissionFeedback
      .create({
        courseId,
        contentItemId,
        userId,
        feedbackId: write.feedbackId,
        kind: 'returned',
        ...(write.feedback === undefined ? {} : { feedback: write.feedback }),
        points: write.points,
        pointsOutOf: write.pointsOutOf,
        version,
        givenAt: write.givenAt,
        givenBy: write.givenBy,
      })
      .commit(),
    ...(await notificationWrites(
      service,
      studentNotification('assignment.returned', write),
    )),
  ];
};

/**
 * Asks the student to resubmit, with feedback and no points: 4 items. The
 * submission must be `submitted`, at the version and review revision read.
 */
export const requestResubmissionWrites = async (
  service: CoreTable,
  write: RequestResubmissionWrite,
): Promise<NotificationTransactionItems> => {
  requireFeedback(write.feedback);
  checkFeedbackLength(write.feedback);
  const { assignmentSubmission, submissionFeedback } =
    transactionEntities(service);
  const { courseId, contentItemId, userId, version, reviewRevision } = write;
  return [
    assignmentSubmission
      .patch({ courseId, contentItemId, userId })
      .set({
        status: 'resubmission_requested',
        reviewRevision: reviewRevision + 1,
      })
      .remove(['waitingCourseId', 'waitingSince'])
      .where(
        (attr, op) =>
          `${op.eq(attr.version, version)} AND ${op.eq(attr.reviewRevision, reviewRevision)} AND ${op.eq(attr.status, 'submitted')}`,
      )
      .commit(),
    submissionFeedback
      .create({
        courseId,
        contentItemId,
        userId,
        feedbackId: write.feedbackId,
        kind: 'resubmission_requested',
        feedback: write.feedback,
        version,
        givenAt: write.givenAt,
        givenBy: write.givenBy,
      })
      .commit(),
    ...(await notificationWrites(
      service,
      studentNotification('assignment.resubmission_requested', write),
    )),
  ];
};

/**
 * Changes a returned submission's grade: 4 items. `returnedAt` and
 * `returnedBy` stay as the first return left them. The submission must be
 * `returned`, at the review revision the instructor read.
 */
export const amendGradeWrites = async (
  service: CoreTable,
  write: AmendGradeWrite,
): Promise<NotificationTransactionItems> => {
  checkFeedbackLength(write.feedback);
  const { assignmentSubmission, submissionFeedback } =
    transactionEntities(service);
  const { courseId, contentItemId, userId, version, reviewRevision } = write;
  return [
    assignmentSubmission
      .patch({ courseId, contentItemId, userId })
      .set({
        points: write.points,
        pointsOutOf: write.pointsOutOf,
        gradedAt: write.givenAt,
        reviewRevision: reviewRevision + 1,
      })
      .where(
        (attr, op) =>
          `${op.eq(attr.status, 'returned')} AND ${op.eq(attr.reviewRevision, reviewRevision)}`,
      )
      .commit(),
    submissionFeedback
      .create({
        courseId,
        contentItemId,
        userId,
        feedbackId: write.feedbackId,
        kind: 'amended',
        ...(write.feedback === undefined ? {} : { feedback: write.feedback }),
        points: write.points,
        pointsOutOf: write.pointsOutOf,
        version,
        givenAt: write.givenAt,
        givenBy: write.givenBy,
      })
      .commit(),
    ...(await notificationWrites(
      service,
      studentNotification('assignment.grade_updated', write),
    )),
  ];
};

export interface SubmissionsReceivedNotice {
  courseId: string;
  contentItemId: string;
  /** The UTC day of the submission, YYYY-MM-DD. */
  day: string;
  /** When the submission was made, the notification's time. */
  occurredAt: string;
  instructorIds: string[];
  assignmentTitle: string;
  courseTitle: string;
}

/**
 * The day's first notice of new submissions to an assignment: the marker
 * (created only if absent, expiring two days after `day`) and one
 * `assignment.submissions_received` per instructor, the first
 * MAX_SUBMISSION_NOTICE_INSTRUCTORS of them so the submission stays within a
 * transaction. The dedupe key names the assignment and day, so a transaction
 * that commits twice notifies once.
 */
export const submissionsReceivedNotificationWrites = async (
  service: CoreTable,
  notice: SubmissionsReceivedNotice,
): Promise<NotificationTransactionItems> => {
  const { submissionNotice } = transactionEntities(service);
  const { courseId, contentItemId, day } = notice;
  const expiresAt = Date.parse(`${day}T00:00:00.000Z`) + 2 * DAY_MS;
  const items: NotificationTransactionItems = [
    submissionNotice
      .create({ courseId, contentItemId, day, ttl: expiresAt / 1000 })
      .commit(),
  ];
  for (const userId of [...new Set(notice.instructorIds)].slice(
    0,
    MAX_SUBMISSION_NOTICE_INSTRUCTORS,
  )) {
    items.push(
      ...(await notificationWrites(service, {
        type: 'assignment.submissions_received',
        userId,
        params: {
          courseId,
          contentItemId,
          assignmentTitle: notice.assignmentTitle,
          courseTitle: notice.courseTitle,
        },
        dedupeKey: `${contentItemId}:${day}`,
        occurredAt: notice.occurredAt,
      })),
    );
  }
  return items;
};
