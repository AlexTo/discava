/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { CreateContentItemVideoUrlOutputSchema } from './content-item.js';

// The longest a course's preview video may be; core-table's
// PREVIEW_MAX_SECONDS, not imported so the schema (which the portals import
// for types) doesn't pull in the table.
export const PREVIEW_MAX_SECONDS = 300;

// A course's preview as the editor needs it: never a key, nonce or uploader.
export const CoursePreviewSummarySchema = z.object({
  status: z.enum(['processing', 'ready', 'failed']),
  failureReason: z.enum(['too-long', 'transcode-error']).optional(),
  durationSeconds: z.number(),
  // Whether a version can be played now: its own once ready, else the previous
  // one kept while a replacement processes or after it failed.
  hasPlayableVersion: z.boolean(),
  // The attempt the editor read; Replace and Remove send it back so they lose
  // to a change made since.
  submissionNonce: z.string(),
});

export type ICoursePreviewSummary = z.output<typeof CoursePreviewSummarySchema>;

export const CreateCoursePreviewUploadUrlInputSchema = z.object({
  courseId: z.string(),
  fileName: z.string().min(1),
});

export const CreateCoursePreviewUploadUrlOutputSchema = z.object({
  uploadUrl: z.string(),
  objectKey: z.string(),
});

export const CreateCoursePreviewInputSchema = z.object({
  courseId: z.string(),
  rawKey: z.string(),
  // The duration the browser read from the file; replaced by the transcoded one.
  durationSeconds: z.number().min(1),
});

export const ReplaceCoursePreviewInputSchema =
  CreateCoursePreviewInputSchema.extend({
    expectedSubmissionNonce: z.string(),
  });

export const CoursePreviewOutputSchema = CoursePreviewSummarySchema;

export const RemoveCoursePreviewInputSchema = z.object({
  courseId: z.string(),
  expectedSubmissionNonce: z.string(),
});

export const RemoveCoursePreviewOutputSchema = z.object({
  removed: z.literal(true),
});

export const CreateCoursePreviewVideoUrlInputSchema = z.object({
  courseId: z.string(),
});

export const CreateCoursePreviewVideoUrlOutputSchema =
  CreateContentItemVideoUrlOutputSchema;
