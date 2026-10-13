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
