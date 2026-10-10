/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  type CancellationReasons,
  failedCondition,
  hasTransactionConflict,
  transactionConflict,
} from '../lib/transaction.js';
import {
  EnrolInputSchema,
  EnrolOutputSchema,
  type IEnrolment,
  MyEnrolmentInputSchema,
  MyEnrolmentOutputSchema,
} from '../schema/index.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

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

// Enrols the caller in a published course. The course's status is checked in
// the same transaction as the write, so a course archived (or deleted) while
// this runs can't take a new enrolment. Enrolling again returns the existing
// enrolment, whatever the course's status now.
export const enrol = courseProcedure
  .input(EnrolInputSchema)
  .output(EnrolOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;
    const userId = ctx.user.sub;

    const { canceled, data } = await coreTable.transaction
      .write(({ course, enrolment }) => [
        course
          .check({ courseId })
          .where((attr, op) => op.eq(attr.status, 'published'))
          .commit(),
        enrolment.create({ courseId, userId }).commit(),
      ])
      .go();

    if (canceled) {
      const reasons: CancellationReasons = data ?? [];
      // Already enrolled. Checked first: a student enrolled before the course
      // was archived is still enrolled.
      if (failedCondition(reasons, 1)) {
        const existing = await getEnrolment(coreTable, courseId, userId);
        if (existing) {
          return existing;
        }
      }
      // Draft, archived or missing: NOT_FOUND either way, as publicView does,
      // so a draft's existence isn't leaked.
      if (failedCondition(reasons, 0)) {
        throw new TRPCError({ code: 'NOT_FOUND' });
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
    getEnrolment(ctx.coreTable!, input.courseId, ctx.user.sub),
  );
