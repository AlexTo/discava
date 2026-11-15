/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { studentActivityWrites } from './student-activity.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

// A student's submission to an upload assignment (#102). Every writer builds
// its transaction from assignmentSubmissionWrites, so the rules that span
// records are kept in one place:
// - everything studentActivityWrites checks and moves (course published,
//   ancestors and item shown, enrolled, lastActivityAt forward);
// - the item's studentActivityCount counts the student once, from their
//   first record of it: a submission, or a completion written before this
//   existed, already counted them;
// - the first submission creates the item's completion; a resubmission
//   writes none;
// - a resubmission only replaces the version it read, and only while the
//   submission hasn't been returned;
// - `late` and `submittedAt` are set here, from one time and the item's due
//   date, so the stored flag always agrees with the stored time.

export interface AssignmentSubmissionFile {
  key: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface AssignmentSubmissionWrite {
  userId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  /** From studentActivityAt: becomes `submittedAt` and the activity time. */
  at: string;
  /** The item's due date, as read in the same try. */
  dueAt?: string;
  file: AssignmentSubmissionFile;
  /** The student's submission as read; undefined for a first submission. */
  existing?: { version: number };
  /** Whether the student already has a completion of the item. */
  hasCompletion: boolean;
}

/** Whether work submitted at `submittedAt` is late for `dueAt`. */
export const isLateSubmission = (submittedAt: string, dueAt?: string) =>
  dueAt !== undefined && submittedAt > dueAt;

/**
 * The checks and writes of one submission's transaction. A failed condition
 * cancels the whole transaction; the caller reads again and decides.
 */
export const assignmentSubmissionWrites = (
  entities: TransactionEntities,
  write: AssignmentSubmissionWrite,
): ReturnType<TransactionWrites> => {
  const { assignmentSubmission, itemCompletion } = entities;
  const {
    userId,
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    at,
    dueAt,
    file,
    existing,
    hasCompletion,
  } = write;
  const late = isLateSubmission(at, dueAt);
  const key = { courseId, contentItemId, userId };
  const completionKey = { userId, courseId, lessonId, contentItemId };

  const activity = studentActivityWrites(entities, {
    userId,
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    at,
    firstRecord: existing === undefined && !hasCompletion,
  });

  if (existing) {
    return [
      ...activity,
      assignmentSubmission
        .patch(key)
        .set({ file, submittedAt: at, late, version: existing.version + 1 })
        .where(
          (attr, op) =>
            `${op.eq(attr.version, existing.version)} AND ${op.eq(attr.status, 'submitted')}`,
        )
        .commit(),
    ];
  }
  return [
    ...activity,
    assignmentSubmission
      .create({
        ...key,
        moduleId,
        lessonId,
        file,
        status: 'submitted',
        submittedAt: at,
        late,
        version: 1,
      })
      .commit(),
    // An existing completion (from before submissions counted) is checked,
    // not created, so the first submission can't fail forever on it.
    hasCompletion
      ? itemCompletion
          .check(completionKey)
          .where((attr, op) => op.exists(attr.userId))
          .commit()
      : itemCompletion
          .create({ ...completionKey, moduleId, completedAt: at })
          .commit(),
  ];
};
