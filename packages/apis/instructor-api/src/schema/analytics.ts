/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { CourseStatusSchema } from './course.js';

// What the instructor dashboard shows (specs/20261115-210425-instructor-
// dashboard/contracts/instructor-api-analytics.md). Aggregates only: no
// student identifier appears in any of it.

/** Input of every procedure scoped to one course. */
export const AnalyticsCourseInputSchema = z.object({
  courseId: z.string().min(1),
});

export const CourseSummarySchema = z.object({
  courseId: z.string(),
  title: z.string(),
  status: CourseStatusSchema,
  /** All-time enrolments. */
  enrolments: z.number().int().nonnegative(),
  /** Learners active in the current UTC calendar week. */
  activeThisWeek: z.number().int().nonnegative(),
  /**
   * `completed / (enrolments - dropped)` as a whole percent, rounded down;
   * null when nobody is enrolled and active.
   */
  completionRate: z.number().int().min(0).max(100).nullable(),
  /** When anything about the course's analytics last changed. */
  updatedAt: z.string().nullable(),
});

export type ICourseSummary = z.output<typeof CourseSummarySchema>;

export const CourseSummariesOutputSchema = z.array(CourseSummarySchema);

export type ICourseSummariesOutput = z.output<
  typeof CourseSummariesOutputSchema
>;

const CountSchema = z.number().int().nonnegative();

/** The ranges of the daily series the dashboard offers. */
export const AnalyticsDaysSchema = z.union([z.literal(30), z.literal(90)]);

export const CourseAnalyticsInputSchema = z.object({
  days: AnalyticsDaysSchema.default(90),
});

export const CourseTotalsSchema = z.object({
  enrolments: CountSchema,
  /** Enrolled, and neither completed nor dropped. */
  active: CountSchema,
  completed: CountSchema,
  dropped: CountSchema,
  completionRate: z.number().int().min(0).max(100).nullable(),
  activeThisWeek: CountSchema,
  updatedAt: z.string().nullable(),
});

export const CourseDaySchema = z.object({
  /** The UTC day, `yyyy-mm-dd`. */
  date: z.string(),
  enrolments: CountSchema,
  activeLearners: CountSchema,
});

export const CourseAnalyticsOutputSchema = z.object({
  totals: CourseTotalsSchema,
  /** Exactly `days` entries, oldest first, zero filled. */
  daily: z.array(CourseDaySchema),
  // Filled by the drop-off and quiz stories; empty until then.
  lessons: z.array(z.never()),
  quizzes: z.array(z.never()),
});

export type ICourseAnalyticsOutput = z.output<
  typeof CourseAnalyticsOutputSchema
>;
