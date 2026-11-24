/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Admin removal of course reviews (specs/_archive/20261116-013307-course-reviews/
// contracts/admin-api-review.md). The reason's limit is core-table's
// (REVIEW_REMOVED_REASON_MAX), which checks it again before writing.

const REASON_MAX = 200;

export const ReviewCourseSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  status: z.enum(['published', 'archived']),
  ratingCount: z.number(),
});

export type IReviewCourse = z.output<typeof ReviewCourseSchema>;

export const ListReviewCoursesInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const ListReviewCoursesOutputSchema = z.object({
  items: z.array(ReviewCourseSchema),
  cursor: z.string().optional(),
});

export const ReviewResponseSchema = z.object({
  text: z.string(),
  byName: z.string(),
  at: z.string(),
});

// A review as an admin sees it: the student's ID so it can be removed, the
// removal's details, never an email or version.
export const AdminReviewSchema = z.object({
  reviewerId: z.string(),
  reviewerName: z.string(),
  rating: z.number(),
  text: z.string().optional(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  status: z.enum(['visible', 'removed']),
  removedAt: z.string().optional(),
  removedBy: z.string().optional(),
  removedReason: z.string().optional(),
  response: ReviewResponseSchema.optional(),
});

export type IAdminReview = z.output<typeof AdminReviewSchema>;

export const ListAdminReviewsInputSchema = z.object({
  courseId: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const ListAdminReviewsOutputSchema = z.object({
  items: z.array(AdminReviewSchema),
  cursor: z.string().optional(),
});

export const RemoveReviewInputSchema = z.object({
  courseId: z.string().min(1),
  reviewerId: z.string().min(1),
  reason: z.string().trim().min(1).max(REASON_MAX),
});

export type IRemoveReviewInput = z.output<typeof RemoveReviewInputSchema>;

export const RemoveReviewOutputSchema = AdminReviewSchema;
