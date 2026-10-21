/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const EnrolmentSchema = z.object({
  courseId: z.string(),
  userId: z.string(),
  status: z.enum(['active', 'completed', 'dropped']),
  progressPercent: z.number(),
  // When the student completed the course; set with status 'completed'.
  completedAt: z.string().optional(),
  // When the student last completed an item or submitted a quiz attempt.
  lastActivityAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IEnrolment = z.output<typeof EnrolmentSchema>;

export const EnrolInputSchema = z.object({
  courseId: z.string(),
});

export type IEnrolInput = z.output<typeof EnrolInputSchema>;

export const EnrolOutputSchema = EnrolmentSchema;

export const MyEnrolmentInputSchema = z.object({
  courseId: z.string(),
});

export type IMyEnrolmentInput = z.output<typeof MyEnrolmentInputSchema>;

// null when the caller isn't enrolled in the course.
export const MyEnrolmentOutputSchema = EnrolmentSchema.nullable();

export const MyEnrolmentsInputSchema = z.object({}).optional();

export type IMyEnrolmentsInput = z.output<typeof MyEnrolmentsInputSchema>;

// Where a student picks a course up: the first lesson, in course order, that
// they haven't completed.
export const NextLessonSchema = z.object({
  lessonId: z.string(),
  title: z.string(),
  moduleTitle: z.string(),
  // 0-based position of its module in the course.
  moduleIndex: z.number(),
});

export const MyEnrolmentSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  imageKey: z.string().optional(),
  // An archived course stays readable to its students.
  courseStatus: z.enum(['published', 'archived']),
  status: z.enum(['active', 'completed']),
  progressPercent: z.number(),
  completedAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
  enrolledAt: z.string(),
  // Null once every lesson is complete, or when the course has none.
  nextLesson: NextLessonSchema.nullable(),
  // Items added to lessons the student had completed (#148 7f).
  newItemCount: z.number(),
});

export type IMyEnrolment = z.output<typeof MyEnrolmentSchema>;

// The caller's enrolments that aren't dropped, most recently active first
// (last activity, else when they enrolled).
export const MyEnrolmentsOutputSchema = z.object({
  items: z.array(MyEnrolmentSchema),
});

export type IMyEnrolmentsOutput = z.output<typeof MyEnrolmentsOutputSchema>;
