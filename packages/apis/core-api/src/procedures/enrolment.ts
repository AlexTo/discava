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
  restoreFreeEnrolment,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  EnrolInputSchema,
  EnrolOutputSchema,
  type IEnrolment,
  MyEnrolmentInputSchema,
  MyEnrolmentOutputSchema,
} from '../schema/index.js';

// ElectroDB types `progressPercent` as optional because it has a default,
// but every enrolment is written with it.
export const getEnrolment = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) =>
  (await coreTable.entities.enrolment.get({ courseId, userId }).go())
    .data as IEnrolment | null;

// Only enrolled students read a course's content, including after it's
// archived. Anyone else learns only that a published course exists, which
// publicView shows them anyway; a draft or archived course is NOT_FOUND, so
// its existence isn't leaked.
export const requireEnrolment = (
  course: { status: string },
  enrolment: IEnrolment | null,
) => {
  if (!enrolment || enrolment.status === 'dropped') {
    throw new TRPCError(
      course.status === 'published'
        ? { code: 'FORBIDDEN', message: 'Enrol in the course to view it' }
        : { code: 'NOT_FOUND' },
    );
  }
};

// Why the course can't be entered by this route: a published course with a
// price is entered only by a paid order (`settleOrderPaid`); a draft, archived
// or missing one is NOT_FOUND, as publicView does, so a draft's existence
// isn't leaked.
const courseUnavailable = async (coreTable: CoreTable, courseId: string) => {
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  return course?.status === 'published' && course.priceAmount > 0
    ? new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This course must be purchased',
      })
    : new TRPCError({ code: 'NOT_FOUND' });
};

// Enrols the caller in a published, free course. The course's status and price
// are checked in the same transaction as the write, so a course archived (or
// deleted) or priced while this runs can't take a new enrolment. A priced
// course is entered only by a paid order (`settleOrderPaid`), never here, and
// `enrol` never writes `orderId`. Enrolling again returns the existing
// enrolment, whatever the course's status or price now. A refunded student
// (`dropped`) re-enters a course that is free again here.
export const enrol = courseProcedure
  .input(EnrolInputSchema)
  .output(EnrolOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId } = input;
    const userId = ctx.user.sub;

    const { canceled, data } = await coreTable.transaction
      .write(({ course, enrolment }) => [
        course
          .check({ courseId })
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'published')} AND ${op.eq(attr.priceAmount, 0)}`,
          )
          .commit(),
        enrolment.create({ courseId, userId }).commit(),
      ])
      .go();

    if (canceled) {
      const reasons = cancellationReasons(data);
      // Already enrolled. Checked first: a student enrolled before the course
      // was archived or priced is still enrolled.
      if (failedAt(reasons, 1)) {
        const existing = await getEnrolment(coreTable, courseId, userId);
        if (existing?.status === 'dropped') {
          const restored = await restoreFreeEnrolment({
            coreTable,
            courseId,
            userId,
          });
          if (restored === 'course-unavailable') {
            throw await courseUnavailable(coreTable, courseId);
          }
          // Restored, or someone else got there first: read it again.
          const current = await getEnrolment(coreTable, courseId, userId);
          if (current) {
            return current;
          }
        } else if (existing) {
          return existing;
        }
      }
      if (failedAt(reasons, 0)) {
        throw await courseUnavailable(coreTable, courseId);
      }
      if (hasTransactionConflict(reasons)) {
        throw transactionConflict();
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to enrol',
      });
    }

    // Transactions don't return the written attributes.
    const enrolment = await getEnrolment(coreTable, courseId, userId);
    if (!enrolment) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'The enrolment was not found after it was written',
      });
    }
    return enrolment;
  });

// The caller's enrolment in a course, or null, so the portal can offer Enrol
// or Continue.
export const myEnrolment = courseProcedure
  .input(MyEnrolmentInputSchema)
  .output(MyEnrolmentOutputSchema)
  .query(async ({ ctx, input }) =>
    getEnrolment(ctx.coreTable, input.courseId, ctx.user.sub),
  );
