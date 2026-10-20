/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  MyLessonProgressInputSchema,
  MyLessonProgressOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

// The caller's progress in each lesson of a course, for the lesson player's
// outline and "N new items" (#148 7c, 7f). Progress recalculation is its only
// writer, so this lags a completion by the stream's batching window; the
// player combines it with course.myItemCompletions for what it shows right away.
export const myLessonProgress = courseProcedure
  .input(MyLessonProgressInputSchema)
  .output(MyLessonProgressOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;
    const { courseId } = input;

    const [{ data: course }, enrolment] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      getEnrolment(coreTable, courseId, userId),
    ]);
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);

    // Every page: a long course can have more lessons than one page holds.
    const { data } = await coreTable.entities.progress.query
      .primary({ userId, courseId })
      .go({ pages: 'all' });
    return {
      lessons: data.map(({ lessonId, status, completedAt }) => ({
        lessonId,
        status,
        ...(completedAt && { completedAt }),
      })),
    };
  });
