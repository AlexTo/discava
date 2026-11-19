/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import type { CoreTable } from '@discava/core-table';
import {
  cancellationReasons,
  failedAt,
  hasTransactionConflict,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {
  requireAncestorsNotArchived,
  requireCourseNotArchived,
} from './curriculum-guards.js';

type TransactionWrite = CoreTable['transaction']['write'];
export type TransactionEntities = Parameters<
  Parameters<TransactionWrite>[0]
>[0];
export type TransactionItems = ReturnType<Parameters<TransactionWrite>[0]>;

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

// A claim on the next `order` among a parent's children (see writeAtEnd): the
// parent's lastChildOrder as it was read, and the order to hand out.
export interface OrderClaim {
  lastChildOrder: number | undefined;
  order: number;
}

export // Another record claimed the order first, or was claiming it at that moment
// (TransactionConflict); writeAtEnd reads again and retries.
class OrderTaken extends Error {}

// The condition that the parent's lastChildOrder hasn't moved since it was
// read.
const unclaimedSince = <Attribute>(
  op: {
    eq: (attribute: Attribute, value: number) => string;
    notExists: (attribute: Attribute) => string;
  },
  attribute: Attribute,
  { lastChildOrder }: OrderClaim,
) =>
  lastChildOrder === undefined
    ? op.notExists(attribute)
    : op.eq(attribute, lastChildOrder);

// Lets a transaction land only while the course exists and isn't archived: an
// archived course is read-only (see requireCourseNotArchived), and a check made
// from an earlier read could be overtaken by the course being archived. With a
// claim, it also hands its order to the new or restored module.
export const activeCourseCheck = (
  entities: TransactionEntities,
  courseId: string,
  claim?: OrderClaim,
): TransactionItems[number] => {
  const active: Parameters<
    ReturnType<typeof entities.course.check>['where']
  >[0] = (attr, op) =>
    [
      op.exists(attr.courseId),
      op.ne(attr.status, 'archived'),
      ...(claim ? [unclaimedSince(op, attr.lastChildOrder, claim)] : []),
    ].join(' AND ');
  return claim
    ? entities.course
        .patch({ courseId })
        .set({ lastChildOrder: claim.order })
        .where(active)
        .commit()
    : entities.course.check({ courseId }).where(active).commit();
};

// Condition checks that let a transaction land only while the course and
// every ancestor still exist and aren't archived. They go first in the
// transaction: their position is how a cancellation is attributed back to
// them. With a claim, the nearest ancestor also hands its order to the new or
// restored child.
const ancestorChecks = (
  entities: TransactionEntities,
  { courseId, moduleId, lessonId }: AncestorKey,
  claim?: OrderClaim,
) => {
  const moduleClaim = lessonId === undefined ? claim : undefined;
  const moduleActive: Parameters<
    ReturnType<typeof entities.module.check>['where']
  >[0] = (attr, op) =>
    [
      op.exists(attr.moduleId),
      op.notExists(attr.archivedAt),
      ...(moduleClaim
        ? [unclaimedSince(op, attr.lastChildOrder, moduleClaim)]
        : []),
    ].join(' AND ');
  const lessonActive: Parameters<
    ReturnType<typeof entities.lesson.check>['where']
  >[0] = (attr, op) =>
    [
      op.exists(attr.lessonId),
      op.notExists(attr.archivedAt),
      ...(claim ? [unclaimedSince(op, attr.lastChildOrder, claim)] : []),
    ].join(' AND ');
  return [
    activeCourseCheck(entities, courseId),
    moduleClaim
      ? entities.module
          .patch({ courseId, moduleId })
          .set({ lastChildOrder: moduleClaim.order })
          .where(moduleActive)
          .commit()
      : entities.module
          .check({ courseId, moduleId })
          .where(moduleActive)
          .commit(),
    ...(lessonId === undefined
      ? []
      : [
          claim
            ? entities.lesson
                .patch({ courseId, moduleId, lessonId })
                .set({ lastChildOrder: claim.order })
                .where(lessonActive)
                .commit()
            : entities.lesson
                .check({ courseId, moduleId, lessonId })
                .where(lessonActive)
                .commit(),
        ]),
  ];
};

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
  claim?: OrderClaim,
) => {
  const { canceled, data } = await coreTable.transaction
    .write((entities) => [
      ...ancestorChecks(entities, ancestors, claim),
      ...writes(entities),
    ])
    .go();
  if (!canceled) {
    return;
  }

  // The course, the module, and the lesson when there is one.
  const ancestorCount = ancestors.lessonId === undefined ? 2 : 3;
  const results = cancellationReasons(data);

  if (failedAt(results, 0, ancestorCount)) {
    await requireAncestorsNotArchived(coreTable, ancestors);
    throw claim ? new OrderTaken() : conflict();
  }
  if (failedAt(results, ancestorCount, results.length)) {
    await onWriteConflict();
    throw conflict();
  }
  if (hasTransactionConflict(results)) {
    throw claim ? new OrderTaken() : transactionConflict();
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
  claim?: OrderClaim,
) => {
  const { canceled, data } = await coreTable.transaction
    .write((entities) => [
      activeCourseCheck(entities, courseId, claim),
      ...writes(entities),
    ])
    .go();
  if (!canceled) {
    return;
  }

  const results = cancellationReasons(data);

  if (failedAt(results, 0)) {
    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireCourseNotArchived(course);
    throw claim ? new OrderTaken() : conflict();
  }
  if (failedAt(results, 1, results.length)) {
    await onWriteConflict();
    throw conflict();
  }
  if (hasTransactionConflict(results)) {
    throw claim ? new OrderTaken() : transactionConflict();
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to save the change',
  });
};

// DynamoDB caps a single transaction at 100 items.
export const MAX_TRANSACTION_ITEMS = 100;
