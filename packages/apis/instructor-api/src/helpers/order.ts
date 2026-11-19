/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import type { CoreTable } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {
  type AncestorKey,
  OrderTaken,
  type TransactionEntities,
  type TransactionItems,
  writeInActiveCourse,
  writeUnderActiveAncestors,
} from './ancestor-writes.js';
import {
  getCourseOrThrow,
  refreshInstructorCourseUpdatedAt,
} from './course-access.js';

// Enough for a handful of records added at once: each try, one of them lands.
const MAX_ORDER_TRIES = 5;

// The parent's lastChildOrder and its children's orders, every page: all
// siblings count.
const readOrders = async (
  coreTable: CoreTable,
  { courseId, moduleId, lessonId }: { courseId: string } & Partial<AncestorKey>,
) => {
  const [{ data: parent }, { data: siblings }] = await Promise.all(
    moduleId === undefined
      ? ([
          coreTable.entities.course.get({ courseId }).go(),
          coreTable.entities.module.query
            .primary({ courseId })
            .go({ pages: 'all' }),
        ] as const)
      : lessonId === undefined
        ? ([
            coreTable.entities.module.get({ courseId, moduleId }).go(),
            coreTable.entities.lesson.query
              .primary({ courseId, moduleId })
              .go({ pages: 'all' }),
          ] as const)
        : ([
            coreTable.entities.lesson
              .get({ courseId, moduleId, lessonId })
              .go(),
            coreTable.entities.contentItem.query
              .primary({ courseId, moduleId, lessonId })
              .go({ pages: 'all' }),
          ] as const),
  );
  if (!parent) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return {
    lastChildOrder: parent.lastChildOrder,
    orders: siblings.map(({ order }) => order),
  };
};

// Writes a module (under `{ courseId }`), lesson (`{ courseId, moduleId }`) or
// content item (`{ courseId, moduleId, lessonId }`) at the end of its parent:
// a new one, or one being restored. It goes after all of its siblings,
// archived ones included, so it never collides with an archived sibling
// restored later; the instructor drags it where they want. Its order comes
// from the parent, which records the last one it handed out (lastChildOrder)
// in the same transaction as the write, conditioned on what was read. Of two
// records added at once, one lands and the other reads again and takes the
// next order (#71). The write runs behind the same checks as
// writeUnderActiveAncestors (or writeInActiveCourse, for a module), with the
// same errors.
export const writeAtEnd = async (
  coreTable: CoreTable,
  parent: { courseId: string } & Partial<AncestorKey>,
  writes: (entities: TransactionEntities, order: number) => TransactionItems,
  onWriteConflict?: () => Promise<never> | never,
) => {
  const { courseId, moduleId } = parent;
  for (let tries = 0; tries < MAX_ORDER_TRIES; tries++) {
    const { lastChildOrder, orders } = await readOrders(coreTable, parent);
    const claim = {
      lastChildOrder,
      order: Math.max(lastChildOrder ?? 0, ...orders) + 1,
    };
    const write = (entities: TransactionEntities) =>
      writes(entities, claim.order);
    try {
      if (moduleId === undefined) {
        await writeInActiveCourse(
          coreTable,
          courseId,
          write,
          onWriteConflict,
          claim,
        );
        // Claiming the order updated the course.
        const course = await getCourseOrThrow(coreTable, courseId);
        await refreshInstructorCourseUpdatedAt(
          coreTable,
          courseId,
          course.updatedAt,
        );
      } else {
        await writeUnderActiveAncestors(
          coreTable,
          { ...parent, moduleId },
          write,
          onWriteConflict,
          claim,
        );
      }
      return claim.order;
    } catch (error) {
      if (!(error instanceof OrderTaken)) {
        throw error;
      }
      // Spread out the retries, so the racers don't collide again.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
    }
  }
  throw transactionConflict();
};
