/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readCourseAnalytics, readCourseSummaries } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  AnalyticsCourseInputSchema,
  CourseAnalyticsInputSchema,
  CourseAnalyticsOutputSchema,
  CourseSummariesOutputSchema,
  type ICourseSummary,
} from '../schema/index.js';

// Every procedure about one course's analytics starts here: the caller must
// teach the course. An unknown course and a course taught by someone else
// answer alike (NOT_FOUND), so course ids can't be probed. The input has to
// carry a `courseId`; procedures built on it add what else they take.
export const analyticsCourseProcedure = courseProcedure
  .input(AnalyticsCourseInputSchema)
  .use(async ({ ctx, input, next }) => {
    const { data: membership } = await ctx
      .coreTable!.entities.courseInstructor.get({
        courseId: input.courseId,
        instructorId: ctx.user.sub,
      })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    return next();
  });

// A whole percent, rounded down, of those still enrolled who completed.
const completionRate = (
  completed: number,
  enrolments: number,
  dropped: number,
): number | null => {
  const denominator = enrolments - dropped;
  return denominator > 0
    ? Math.min(100, Math.floor((completed * 100) / denominator))
    : null;
};

// One card per course the caller teaches, whatever its status, most recently
// updated first. Costs the instructor index query, a batch get of the
// courses and two batch gets of aggregates, however many students there are.
export const courseSummaries = courseProcedure
  .output(CourseSummariesOutputSchema)
  .query(async ({ ctx }) => {
    const coreTable = ctx.coreTable!;
    const { data: memberships } =
      await coreTable.entities.courseInstructor.query
        .byInstructor({ instructorId: ctx.user.sub })
        .go({ pages: 'all', order: 'desc' });
    if (memberships.length === 0) {
      return [];
    }

    // preserveBatchOrder keeps the index's recency order, and shows a course
    // deleted after its membership as a gap to drop.
    const { data: courses } = await coreTable.entities.course
      .get(memberships.map(({ courseId }) => ({ courseId })))
      .go({ preserveBatchOrder: true });
    const existing = courses.filter((course) => course !== null);

    const figures = new Map(
      (
        await readCourseSummaries(
          coreTable,
          existing.map(({ courseId }) => courseId),
        )
      ).map((summary) => [summary.courseId, summary]),
    );

    return existing.map(({ courseId, title, status }): ICourseSummary => {
      const summary = figures.get(courseId);
      return {
        courseId,
        title,
        status,
        enrolments: summary?.enrolments ?? 0,
        activeThisWeek: summary?.activeLearners ?? 0,
        completionRate: completionRate(
          summary?.completed ?? 0,
          summary?.enrolments ?? 0,
          summary?.dropped ?? 0,
        ),
        updatedAt: summary?.updatedAt ?? null,
      };
    });
  });

// One course's totals, its last 30 or 90 days and its lessons' drop-off. The
// quizzes are empty until the story that fills them.
export const course = analyticsCourseProcedure
  .input(CourseAnalyticsInputSchema)
  .output(CourseAnalyticsOutputSchema)
  .query(async ({ ctx, input }) => {
    const analytics = await readCourseAnalytics(
      ctx.coreTable!,
      input.courseId,
      input.days,
    );
    return {
      totals: {
        enrolments: analytics.enrolments,
        active: analytics.active,
        completed: analytics.completed,
        dropped: analytics.dropped,
        completionRate: completionRate(
          analytics.completed,
          analytics.enrolments,
          analytics.dropped,
        ),
        activeThisWeek: analytics.activeLearners,
        updatedAt: analytics.updatedAt,
      },
      daily: analytics.daily,
      lessons: analytics.lessons.map(
        ({
          lessonId,
          moduleId,
          title,
          started,
          completed,
          completionShare,
        }) => ({
          lessonId,
          moduleId,
          title,
          started,
          completed,
          completionShare,
        }),
      ),
      quizzes: [],
    };
  });
