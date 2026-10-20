/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const MyProgressInputSchema = z.object({
  courseId: z.string(),
});

export type IMyProgressInput = z.output<typeof MyProgressInputSchema>;

export const LessonProgressSchema = z.object({
  lessonId: z.string(),
  status: z.enum(['not_started', 'in_progress', 'completed']),
  completedAt: z.string().optional(),
});

export type ILessonProgress = z.output<typeof LessonProgressSchema>;

// The caller's progress in each lesson that has any, as progress
// recalculation last wrote it. A lesson without a record hasn't been started.
// The course-level rollup is on the enrolment (course.myEnrolment).
export const MyProgressOutputSchema = z.object({
  lessons: z.array(LessonProgressSchema),
});

export type IMyProgressOutput = z.output<typeof MyProgressOutputSchema>;
