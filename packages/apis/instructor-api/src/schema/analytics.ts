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
