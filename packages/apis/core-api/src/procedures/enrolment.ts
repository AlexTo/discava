/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import type { CoreTable } from '@discava/core-table';
import {
  cancellationReasons,
  dismissFirstLessonPrompt as dismissPrompt,
  EnrolmentPaidForError,
  failedAt,
  hasTransactionConflict,
  NotEnrolledError,
  readRefundedBefore,
  restoreFreeEnrolment,
  unenrolFromCourse,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  DismissFirstLessonPromptInputSchema,
  DismissFirstLessonPromptOutputSchema,
  EnrolInputSchema,
  EnrolOutputSchema,
  type IEnrolment,
  MyEnrolmentInputSchema,
  MyEnrolmentOutputSchema,
  UnenrolInputSchema,
  UnenrolOutputSchema,
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
// its existence isn't leaked. Open preview lessons are read through the
// freePreview router and never through a procedure that calls this function.
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

// `paidFor` tells the portal whether to offer a refund or leaving the course
// without exposing the order.
const withPaidFor = (
  stored: { orderId?: string } & IEnrolment,
  refundedBefore: boolean,
) => ({
  ...stored,
  paidFor: Boolean(stored.orderId),
  refundedBefore,
});

const getMyEnrolment = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) => {
  const stored = (await coreTable.entities.enrolment
    .get({ courseId, userId })
    .go()) as { data: ({ orderId?: string } & IEnrolment) | null };
  if (!stored.data) return null;
  return withPaidFor(
    stored.data,
    await readRefundedBefore({ coreTable, userId, courseId }),
  );
};

// The caller's enrolment in a course, or null, so the portal can offer Enrol
// or Continue.
export const myEnrolment = courseProcedure
  .input(MyEnrolmentInputSchema)
  .output(MyEnrolmentOutputSchema)
  .query(async ({ ctx, input }) =>
    getMyEnrolment(ctx.coreTable, input.courseId, ctx.user.sub),
  );

// A student leaves a course they did not pay for. Progress is kept, and
// `enrol` brings the enrolment back where the course is free. A bought
// enrolment is ended only by a refund. The course's status and price are not
// checked, so a student can leave an archived or since-priced course.
export const unenrol = courseProcedure
  .input(UnenrolInputSchema)
  .output(UnenrolOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { courseId } = input;
    const userId = ctx.user.sub;
    const existing = await getMyEnrolment(ctx.coreTable, courseId, userId);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
    if (existing.status === 'dropped') return existing;
    try {
      await unenrolFromCourse({
        coreTable: ctx.coreTable,
        userId,
        courseId,
        now: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof EnrolmentPaidForError) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'You bought this course; request a refund instead',
        });
      }
      throw error;
    }
    const current = await getMyEnrolment(ctx.coreTable, courseId, userId);
    if (!current) throw new TRPCError({ code: 'NOT_FOUND' });
    return current;
  });

// Closes the first-lesson prompt without answering it. Works whatever the
// course's status, so a prompt can always be closed; an enrolment whose state
// is already set is returned as it is, so a double click or a second device is
// harmless.
export const dismissFirstLessonPrompt = courseProcedure
  .input(DismissFirstLessonPromptInputSchema)
  .output(DismissFirstLessonPromptOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId } = input;
    try {
      return (await dismissPrompt(coreTable, {
        courseId,
        userId: ctx.user.sub,
      })) as IEnrolment;
    } catch (error) {
      if (!(error instanceof NotEnrolledError)) {
        throw error;
      }
      // Refused as the other enrolment-gated procedures refuse.
      const { data: course } = await coreTable.entities.course
        .get({ courseId })
        .go();
      requireEnrolment(course ?? { status: 'missing' }, null);
      throw error;
    }
  });
