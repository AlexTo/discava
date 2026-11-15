/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LESSON_FILE_MAX_BYTES } from '@discava/common-server-utils/lesson-files';
import { z } from 'zod';
import { ContentItemRefSchema } from './completion.js';

// Student submissions to an upload assignment (#102). The student is always
// the caller: no input names a user.

// An upload assignment's single content item, by its full key.
export const AssignmentRefSchema = ContentItemRefSchema;

export type IAssignmentRef = z.output<typeof AssignmentRefSchema>;

const FileNameSchema = z.string().trim().min(1).max(255);

export const UploadUrlInputSchema = AssignmentRefSchema.extend({
  fileName: FileNameSchema,
  // Signed into the upload URL, so the upload has to be exactly this size.
  fileSize: z.number().int().positive().max(LESSON_FILE_MAX_BYTES),
});

export type IUploadUrlInput = z.output<typeof UploadUrlInputSchema>;

export const UploadUrlOutputSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string(),
  headers: z.record(z.string(), z.string()),
});

export type IUploadUrlOutput = z.output<typeof UploadUrlOutputSchema>;

// The one upload `uploadUrl` issued; a resubmission sends a new one.
export const SubmitInputSchema = AssignmentRefSchema.extend({
  objectKey: z.string().min(1),
  fileName: FileNameSchema,
});

export type ISubmitInput = z.output<typeof SubmitInputSchema>;

// A submission as its student sees it. The storage key never leaves the API:
// the file is fetched through a signed link.
export const SubmissionSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(['submitted', 'returned']),
  submittedAt: z.string(),
  late: z.boolean(),
  file: z.object({
    fileName: z.string(),
    fileSize: z.number().int().positive().max(LESSON_FILE_MAX_BYTES),
    mimeType: z.string(),
  }),
});

export type ISubmission = z.output<typeof SubmissionSchema>;

export const SubmitOutputSchema = SubmissionSchema;
