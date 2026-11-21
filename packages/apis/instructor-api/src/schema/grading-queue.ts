/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// The instructor home page's grading queue (specs/20261120-230057-
// assignment-grading/contracts/instructor-api-assignment-submission.md,
// `gradingQueue.list`).

export const GradingQueueInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

export type IGradingQueueInput = z.input<typeof GradingQueueInputSchema>;

export const GradingQueueItemSchema = z.object({
  courseId: z.string(),
  courseTitle: z.string(),
  contentItemId: z.string(),
  assignmentTitle: z.string(),
  userId: z.string(),
  displayName: z.string(),
  submittedAt: z.string(),
  late: z.boolean(),
});

export type IGradingQueueItem = z.output<typeof GradingQueueItemSchema>;

export const GradingQueueOutputSchema = z.object({
  // Every enrolled student's waiting submission across the caller's courses.
  total: z.number(),
  // The oldest `limit` of them.
  items: z.array(GradingQueueItemSchema),
});

export type IGradingQueueOutput = z.output<typeof GradingQueueOutputSchema>;
