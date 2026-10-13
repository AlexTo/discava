/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import type { ICoreTableContext } from '../middleware/core-table.js';
import type { ICurriculumVisibility } from '../schema/index.js';

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;

// Only instructors teaching this specific course may change its curriculum,
// not just any member of the instructor group.
export const requireCourseInstructor = async (
  coreTable: CoreTable,
  courseId: string,
  instructorId: string,
) => {
  const { data: membership } = await coreTable.entities.courseInstructor
    .get({ courseId, instructorId })
    .go();
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
};

export const getCourseOrThrow = async (
  coreTable: CoreTable,
  courseId: string,
) => {
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  if (!course) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return course;
};

// A draft course has never been open to students, so its curriculum is
// edited freely: new records are visible straight away and delete is
// permanent. A published or archived course may have students with
// progress or attempts, so new records start hidden until published and
// delete archives instead.
export const isDraftCourse = (course: { status: string }) =>
  course.status === 'draft';

// A record's visibility when it's created, and its `publishedAt` if that
// makes it visible straight away (see firstPublishedAt).
export const initialVisibilityFields = (course: {
  status: string;
}): { visibility: ICurriculumVisibility; publishedAt?: string } =>
  isDraftCourse(course)
    ? { visibility: 'visible', publishedAt: new Date().toISOString() }
    : { visibility: 'hidden' };

// `publishedAt` records the first time a module, lesson or content item
// became visible, and is never cleared. Publishing a parent publishes only
// hidden descendants that have never been published -- content that's new --
// so one hidden on purpose after it was visible stays hidden. Returns the
// field to set when `record` is being made visible, or nothing if it already
// has one.
export const firstPublishedAt = (record: { publishedAt?: string }) =>
  record.publishedAt ? {} : { publishedAt: new Date().toISOString() };

export const requireNotArchived = (
  record: { archivedAt?: string },
  message: string,
) => {
  if (record.archivedAt) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message });
  }
};

// An archived course is read-only: nothing in it can be added, edited,
// published, hidden, archived or restored until the course is restored. What
// stays possible is permanently deleting records that are already archived,
// so an archived course can be cleaned up without restoring it (which would
// show it to students again).
export const requireCourseNotArchived = (course: { status: string }) => {
  if (course.status === 'archived') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
  }
};

// Reads the course and refuses if it's archived, for writes that sit directly
// under it and have no module to read.
export const requireActiveCourse = async (
  coreTable: CoreTable,
  courseId: string,
) => {
  const course = await getCourseOrThrow(coreTable, courseId);
  requireCourseNotArchived(course);
  return course;
};

// An archived module or lesson freezes everything under it: nothing beneath
// it can be added, edited, published or hidden until it's restored, so a
// restore brings back exactly what was archived. Checks the course first (an
// archived course is read-only, see requireCourseNotArchived), then the
// module, and the lesson too when `lessonId` is given, matching the order
// restores have to happen in.
export const requireAncestorsNotArchived = async (
  coreTable: CoreTable,
  {
    courseId,
    moduleId,
    lessonId,
  }: { courseId: string; moduleId: string; lessonId?: string },
) => {
  const [{ data: course }, { data: module }, lessonResult] = await Promise.all([
    coreTable.entities.course.get({ courseId }).go(),
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    lessonId === undefined
      ? Promise.resolve(undefined)
      : coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
  ]);
  if (!course) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireCourseNotArchived(course);
  if (!module) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireNotArchived(module, 'Restore the module first');
  if (lessonResult !== undefined) {
    if (!lessonResult.data) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(lessonResult.data, 'Restore the lesson first');
  }
};

// Guards a permanent delete in a draft course. The draft/archive decision is
// made from a read of the course's status, which can go stale: if the course
// is published in between, the delete would destroy something in a course
// students can see. Added as the last item of the delete's transaction, so it
// lands only while the course is still a draft.
export const draftCourseCheck = (
  entities: TransactionEntities,
  courseId: string,
) =>
  entities.course
    .check({ courseId })
    .where((attr, op) => op.eq(attr.status, 'draft'))
    .commit();

// DynamoDB cancels one of two transactions that touch the same records at the
// same moment with TransactionConflict, rather than a failed condition.
// Nothing was written and a retry is safe, so it's a CONFLICT, not a server
// error.
export const hasTransactionConflict = (
  results: ({ code?: string } | undefined)[] | undefined,
) => (results ?? []).some((result) => result?.code === 'TransactionConflict');

export const transactionConflict = () =>
  new TRPCError({
    code: 'CONFLICT',
    message:
      'Another request was changing the same records; nothing was changed. Please retry',
  });

export const courseNoLongerDraft = () =>
  new TRPCError({
    code: 'CONFLICT',
    message:
      'The course was published while this was being deleted; nothing was deleted. Retry to archive it instead',
  });

type TransactionWrite = CoreTable['transaction']['write'];
export type TransactionEntities = Parameters<
  Parameters<TransactionWrite>[0]
>[0];
type TransactionItems = ReturnType<Parameters<TransactionWrite>[0]>;

export interface AncestorKey {
  courseId: string;
  moduleId: string;
  lessonId?: string;
}

const conflict = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: 'The record was modified by another request; please retry',
  });

// Lets a transaction land only while the course exists and isn't archived: an
// archived course is read-only (see requireCourseNotArchived), and a check made
// from an earlier read could be overtaken by the course being archived.
export const activeCourseCheck = (
  entities: TransactionEntities,
  courseId: string,
) =>
  entities.course
    .check({ courseId })
    .where(
      (attr, op) =>
        `${op.exists(attr.courseId)} AND ${op.ne(attr.status, 'archived')}`,
    )
    .commit();

// Condition checks that let a transaction land only while the course and
// every ancestor still exist and aren't archived. They go first in the
// transaction: their position is how a cancellation is attributed back to
// them.
const ancestorChecks = (
  entities: TransactionEntities,
  { courseId, moduleId, lessonId }: AncestorKey,
) => [
  activeCourseCheck(entities, courseId),
  entities.module
    .check({ courseId, moduleId })
    .where(
      (attr, op) =>
        `${op.exists(attr.moduleId)} AND ${op.notExists(attr.archivedAt)}`,
    )
    .commit(),
  ...(lessonId === undefined
    ? []
    : [
        entities.lesson
          .check({ courseId, moduleId, lessonId })
          .where(
            (attr, op) =>
              `${op.exists(attr.lessonId)} AND ${op.notExists(attr.archivedAt)}`,
          )
          .commit(),
      ]),
];

// Runs `writes` in one transaction behind condition checks on every
// ancestor, so the write lands only if no ancestor was archived or removed
// in the meantime: checking the ancestors first (requireAncestorsNotArchived)
// and writing afterwards would leave a window where another request archives
// or permanently deletes the parent in between, leaving a child edited under
// an archived parent or orphaned.
//
// On cancellation:
// - an ancestor's check failed: re-checks the ancestors to throw the precise
//   error ("Restore the course first", "Restore the module first",
//   NOT_FOUND), else CONFLICT;
// - one of `writes` failed its own condition: `onWriteConflict` throws the
//   caller's error (CONFLICT by default);
// - another transaction was touching the same records at that moment
//   (TransactionConflict): CONFLICT, since nothing was written and a retry
//   is safe;
// - anything else: INTERNAL_SERVER_ERROR.
export const writeUnderActiveAncestors = async (
  coreTable: CoreTable,
  ancestors: AncestorKey,
  writes: (entities: TransactionEntities) => TransactionItems,
  onWriteConflict: () => Promise<never> | never = () => {
    throw conflict();
  },
) => {
  const { canceled, data } = await coreTable.transaction
    .write((entities) => [
      ...ancestorChecks(entities, ancestors),
      ...writes(entities),
    ])
    .go();
  if (!canceled) {
    return;
  }

  // The course, the module, and the lesson when there is one.
  const ancestorCount = ancestors.lessonId === undefined ? 2 : 3;
  const results: ({ code?: string } | undefined)[] = data ?? [];
  const failedAt = (from: number, to?: number) =>
    results
      .slice(from, to)
      .some((result) => result?.code === 'ConditionalCheckFailed');

  if (failedAt(0, ancestorCount)) {
    await requireAncestorsNotArchived(coreTable, ancestors);
    throw conflict();
  }
  if (failedAt(ancestorCount)) {
    await onWriteConflict();
    throw conflict();
  }
  if (hasTransactionConflict(results)) {
    throw transactionConflict();
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to save the change',
  });
};

// Like writeUnderActiveAncestors for a write that sits directly under the
// course (a module, or the archive of any record): runs `writes` in one
// transaction behind a check that the course still exists and isn't
// archived. Cancellations are attributed the same way: the course check
// failed (a precise "Restore the course first", else CONFLICT), a write
// failed its own condition (`onWriteConflict`), a transaction conflict
// (CONFLICT), anything else (INTERNAL_SERVER_ERROR).
export const writeInActiveCourse = async (
  coreTable: CoreTable,
  courseId: string,
  writes: (entities: TransactionEntities) => TransactionItems,
  onWriteConflict: () => Promise<never> | never = () => {
    throw conflict();
  },
) => {
  const { canceled, data } = await coreTable.transaction
    .write((entities) => [
      activeCourseCheck(entities, courseId),
      ...writes(entities),
    ])
    .go();
  if (!canceled) {
    return;
  }

  const results: ({ code?: string } | undefined)[] = data ?? [];
  const failedAt = (from: number) =>
    results
      .slice(from)
      .some((result) => result?.code === 'ConditionalCheckFailed');

  if (results[0]?.code === 'ConditionalCheckFailed') {
    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireCourseNotArchived(course);
    throw conflict();
  }
  if (failedAt(1)) {
    await onWriteConflict();
    throw conflict();
  }
  if (hasTransactionConflict(results)) {
    throw transactionConflict();
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to save the change',
  });
};

// The `order` that puts a record after all of its siblings, archived ones
// included, so it sorts last and never collides with an archived sibling
// restored later. Used when restoring: a restored record goes to the end of
// its parent, and the instructor drags it where they want.
export const nextOrder = (siblings: { order: number }[]) =>
  siblings.reduce((max, { order }) => Math.max(max, order), 0) + 1;

// DynamoDB caps a single transaction at 100 items.
export const MAX_TRANSACTION_ITEMS = 100;
