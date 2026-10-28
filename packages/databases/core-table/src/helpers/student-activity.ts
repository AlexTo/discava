/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];

// A student's activity on an item: completing it, or submitting a quiz
// attempt. Every procedure that records one builds its transaction from
// studentActivityWrites, so the rules other writers rely on are kept in one
// place (#71):
// - the course is published and the item, its lesson and its module are
//   visible and not archived;
// - the item's studentActivityCount counts each student once, from their
//   first record of it. instructor-api relies on it to refuse deleting an
//   item a student has used;
// - the student is enrolled and hasn't dropped the course;
// - enrolment.lastActivityAt only moves forward.

/**
 * When an activity happens: now, or the student's last activity if that's
 * later (another Lambda's clock may be ahead), so their activity times never
 * go backwards. Record the activity with this time and pass it as `at`.
 */
export const studentActivityAt = (
  enrolment: { lastActivityAt?: string },
  now = new Date(),
) => {
  const at = now.toISOString();
  const { lastActivityAt } = enrolment;
  return lastActivityAt && lastActivityAt > at ? lastActivityAt : at;
};

export interface StudentActivity {
  userId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  /** From studentActivityAt. */
  at: string;
  /** The student's first record of the item, which counts them on it. */
  firstRecord: boolean;
  /** For a quiz: the version the activity was judged against. */
  quizVersion?: number;
}

/**
 * The checks and writes every student activity's transaction includes. Add
 * the activity's own records (the completion, the attempt and summary) beside
 * them. A failed condition cancels the whole transaction; the caller reads
 * again and retries, which gives the precise error or a later `at`.
 */
export const studentActivityWrites = (
  { course, module, lesson, contentItem, enrolment }: TransactionEntities,
  activity: StudentActivity,
): ReturnType<TransactionWrites> => {
  const { userId, courseId, moduleId, lessonId, contentItemId, at } = activity;
  const itemKey = { courseId, moduleId, lessonId, contentItemId };
  const { quizVersion } = activity;
  const itemShown: Parameters<
    ReturnType<typeof contentItem.check>['where']
  >[0] = (attr, op) =>
    [
      op.eq(attr.visibility, 'visible'),
      op.notExists(attr.archivedAt),
      // A quiz still has the settings and questions it was judged by.
      ...(quizVersion === undefined
        ? []
        : [op.eq(attr.quizVersion, quizVersion)]),
    ].join(' AND ');
  return [
    course
      .check({ courseId })
      .where((attr, op) => op.eq(attr.status, 'published'))
      .commit(),
    module
      .check({ courseId, moduleId })
      .where(
        (attr, op) =>
          `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
      )
      .commit(),
    lesson
      .check({ courseId, moduleId, lessonId })
      .where(
        (attr, op) =>
          `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
      )
      .commit(),
    activity.firstRecord
      ? contentItem
          .update(itemKey)
          .add({ studentActivityCount: 1 })
          .where(itemShown)
          .commit()
      : contentItem.check(itemKey).where(itemShown).commit(),
    // Still enrolled, and no later activity has landed since `at` was read.
    enrolment
      .patch({ courseId, userId })
      .set({ lastActivityAt: at })
      .where(
        (attr, op) =>
          `${op.exists(attr.userId)} AND ${op.ne(attr.status, 'dropped')} AND (${op.notExists(attr.lastActivityAt)} OR ${op.lte(attr.lastActivityAt, at)})`,
      )
      .commit(),
  ];
};
