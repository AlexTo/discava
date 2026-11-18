/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Instructor responses to course reviews (specs/20261116-013307-course-reviews/
// contracts/instructor-api-review.md). The limit is core-table's
// (REVIEW_RESPONSE_MAX), which checks it again before writing.

const RESPONSE_MAX = 1000;

export const ReviewResponseSchema = z.object({
  text: z.string(),
  byName: z.string(),
  at: z.string(),
});

// A review as the course's instructors see it: the student's ID so they can
// answer it, never an email, version or removal field.
export const InstructorReviewSchema = z.object({
  reviewerId: z.string(),
  reviewerName: z.string(),
  rating: z.number(),
  text: z.string().optional(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  response: ReviewResponseSchema.optional(),
});

export type IInstructorReview = z.output<typeof InstructorReviewSchema>;

export const ListReviewsInputSchema = z.object({
  courseId: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type IListReviewsInput = z.output<typeof ListReviewsInputSchema>;

export const ListReviewsOutputSchema = z.object({
  items: z.array(InstructorReviewSchema),
  cursor: z.string().optional(),
});

export type IListReviewsOutput = z.output<typeof ListReviewsOutputSchema>;

export const RespondToReviewInputSchema = z.object({
  courseId: z.string().min(1),
  reviewerId: z.string().min(1),
  text: z.string().trim().min(1).max(RESPONSE_MAX),
});

export type IRespondToReviewInput = z.output<typeof RespondToReviewInputSchema>;

export const RespondToReviewOutputSchema = InstructorReviewSchema;

export const DeleteReviewResponseInputSchema = z.object({
  courseId: z.string().min(1),
  reviewerId: z.string().min(1),
});

export type IDeleteReviewResponseInput = z.output<
  typeof DeleteReviewResponseInputSchema
>;

export const DeleteReviewResponseOutputSchema = InstructorReviewSchema;
