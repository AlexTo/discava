/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import {
  cancellationReasons,
  courseLandingWrites,
  failedAt,
  InvalidRequestError,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import {} from '../helpers/course-access.js';
import { courseInstructorProcedure } from '../init.js';
import {
  UpdateCourseLandingInputSchema,
  UpdateCourseLandingOutputSchema,
} from '../schema/index.js';

/**
 * Replaces a course's learning outcomes and requirements, shown on its public
 * landing page. Allowed in any course status, archived included: the page is
 * just not public then. One transaction writes the course and its
 * instructors' copy of its updatedAt.
 */
export const updateCourseLanding = courseInstructorProcedure(
  UpdateCourseLandingInputSchema,
)
  .output(UpdateCourseLandingOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, learningOutcomes, requirements } = input;

    try {
      const items = await courseLandingWrites.set(coreTable, {
        courseId,
        learningOutcomes,
        requirements,
        now: new Date(),
      });
      const { canceled, data: results } = await coreTable.transaction
        .write(() => items)
        .go();
      if (canceled) {
        // The course patch is the first item; it fails its condition only if
        // the course is gone.
        const courseGone = failedAt(cancellationReasons(results), 0);
        throw courseGone
          ? new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' })
          : transactionConflict();
      }
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }

    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return course;
  });
