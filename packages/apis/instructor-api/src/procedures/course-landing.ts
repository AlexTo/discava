/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { courseLandingWrites, InvalidRequestError } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  requireCourseInstructor,
  transactionConflict,
} from '../lib/course-lifecycle.js';
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
export const updateCourseLanding = courseProcedure
  .input(UpdateCourseLandingInputSchema)
  .output(UpdateCourseLandingOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, learningOutcomes, requirements } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

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
        const courseGone =
          (results as { code?: string }[] | undefined)?.[0]?.code ===
          'ConditionalCheckFailed';
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
