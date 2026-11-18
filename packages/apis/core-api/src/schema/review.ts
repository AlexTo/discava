/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { createPaginatedQueryOutputSchema } from './common.js';

const REVIEW_TEXT_MAX = 2000;

const RatingSchema = z.number().int().min(1).max(5);

// Trimmed; whitespace-only is stored as absent.
const ReviewTextSchema = z
  .string()
  .trim()
  .max(REVIEW_TEXT_MAX)
  .transform((text) => (text === '' ? undefined : text))
  .optional();

const ReviewResponseSchema = z.object({
  text: z.string(),
  byName: z.string(),
  at: z.string(),
});

// What anyone may see of a review: never the userId, version, status or
// anything about its removal.
export const PublicReviewSchema = z.object({
  reviewerName: z.string(),
  rating: z.number(),
  text: z.string().optional(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  response: ReviewResponseSchema.optional(),
});

export type IPublicReview = z.output<typeof PublicReviewSchema>;

export const OwnReviewSchema = z.object({
  rating: z.number(),
  text: z.string().optional(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  version: z.number(),
  status: z.enum(['visible', 'removed']),
  removedReason: z.string().optional(),
  response: ReviewResponseSchema.optional(),
});

export type IOwnReview = z.output<typeof OwnReviewSchema>;

export const ReviewSummaryInputSchema = z.object({
  courseId: z.string(),
});

export const ReviewSummaryOutputSchema = z.object({
  count: z.number(),
  // To one decimal; absent when count is 0.
  average: z.number().optional(),
  stars: z.object({
    1: z.number(),
    2: z.number(),
    3: z.number(),
    4: z.number(),
    5: z.number(),
  }),
});

export type IReviewSummaryOutput = z.output<typeof ReviewSummaryOutputSchema>;

export const ReviewListInputSchema = z.object({
  courseId: z.string(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional().default(10),
});

export const ReviewListOutputSchema =
  createPaginatedQueryOutputSchema(PublicReviewSchema);

export const MyReviewInputSchema = z.object({
  courseId: z.string(),
});

export const MyReviewOutputSchema = OwnReviewSchema.nullable();

export const PostReviewInputSchema = z.object({
  courseId: z.string(),
  rating: RatingSchema,
  text: ReviewTextSchema,
});

export const EditReviewInputSchema = z.object({
  courseId: z.string(),
  rating: RatingSchema,
  text: ReviewTextSchema,
  version: z.number().int().positive(),
});

export const DeleteReviewInputSchema = z.object({
  courseId: z.string(),
  version: z.number().int().positive(),
});

export const DeleteReviewOutputSchema = z.object({
  deleted: z.literal(true),
});
