/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  isValidTiptapDocument,
  plainTextExcerpt,
} from '@discava/common-tiptap';
import { z } from 'zod';

// Grading uploaded work (specs/20261120-230057-assignment-grading/contracts/
// instructor-api-assignment-submission.md). The limits are core-table's
// (helpers/assignment-grading.ts), which checks them again before writing.

export const FeedbackSchema = z
  .string()
  .max(20_000)
  .refine(
    isValidTiptapDocument,
    'feedback must be a valid Tiptap JSON document',
  );

// At most two decimal places; the upper bound is the assignment's maxPoints,
// checked against the item.
export const PointsSchema = z.number().min(0).multipleOf(0.01);

export const SubmissionStateSchema = z.enum([
  'not_submitted',
  'submitted',
  'resubmission_requested',
  'returned',
]);

export type ISubmissionState = z.output<typeof SubmissionStateSchema>;

const AssignmentRefSchema = z.object({
  courseId: z.string().min(1),
  contentItemId: z.string().min(1),
});

const StudentRefSchema = AssignmentRefSchema.extend({
  userId: z.string().min(1),
});

export const ListSubmissionsInputSchema = AssignmentRefSchema.extend({
  cursor: z.string().min(1).optional(),
});

export type IListSubmissionsInput = z.output<typeof ListSubmissionsInputSchema>;

const AssignmentSummarySchema = z.object({
  title: z.string(),
  maxPoints: z.number(),
  dueAt: z.string().optional(),
});

export const SubmissionRowSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  // false: no longer enrolled, read-only.
  enrolled: z.boolean(),
  state: SubmissionStateSchema,
  late: z.boolean().optional(),
  submittedAt: z.string().optional(),
  version: z.number().int().optional(),
  points: z.number().optional(),
  pointsOutOf: z.number().optional(),
});

export type ISubmissionRow = z.output<typeof SubmissionRowSchema>;

export const SubmissionCountsSchema = z.object({
  waiting: z.number().int(),
  resubmissionRequested: z.number().int(),
  returned: z.number().int(),
  notSubmitted: z.number().int(),
});

export type ISubmissionCounts = z.output<typeof SubmissionCountsSchema>;

export const ListSubmissionsOutputSchema = z.object({
  assignment: AssignmentSummarySchema,
  counts: SubmissionCountsSchema,
  rows: z.array(SubmissionRowSchema),
  nextCursor: z.string().optional(),
});

export type IListSubmissionsOutput = z.output<
  typeof ListSubmissionsOutputSchema
>;

export const GetSubmissionInputSchema = StudentRefSchema;

export const FeedbackRoundSchema = z.object({
  feedbackId: z.string(),
  kind: z.enum(['resubmission_requested', 'returned', 'amended']),
  feedback: z.string().optional(),
  points: z.number().optional(),
  pointsOutOf: z.number().optional(),
  version: z.number().int(),
  givenAt: z.string(),
  givenBy: z.object({ userId: z.string(), displayName: z.string() }),
});

export type IFeedbackRound = z.output<typeof FeedbackRoundSchema>;

export const GetSubmissionOutputSchema = z.object({
  assignment: AssignmentSummarySchema,
  student: z.object({
    userId: z.string(),
    displayName: z.string(),
    enrolled: z.boolean(),
  }),
  submission: z
    .object({
      state: z.enum(['submitted', 'resubmission_requested', 'returned']),
      version: z.number().int(),
      // Sent back with any write.
      reviewRevision: z.number().int(),
      submittedAt: z.string(),
      late: z.boolean(),
      file: z.object({
        fileName: z.string(),
        fileSize: z.number(),
        mimeType: z.string(),
        previewable: z.enum(['pdf', 'image']).nullable(),
      }),
      points: z.number().optional(),
      pointsOutOf: z.number().optional(),
      returnedAt: z.string().optional(),
      gradedAt: z.string().optional(),
    })
    .nullable(),
  // Newest first.
  feedback: z.array(FeedbackRoundSchema),
});

export type IGetSubmissionOutput = z.output<typeof GetSubmissionOutputSchema>;

export const SubmissionFileUrlInputSchema = StudentRefSchema;

export const SubmissionFileUrlOutputSchema = z.object({ url: z.string() });

export const ReturnSubmissionInputSchema = StudentRefSchema.extend({
  version: z.number().int().min(1),
  reviewRevision: z.number().int().min(0),
  points: PointsSchema,
  feedback: FeedbackSchema.optional(),
});

export type IReturnSubmissionInput = z.output<
  typeof ReturnSubmissionInputSchema
>;

export const RequestResubmissionInputSchema = StudentRefSchema.extend({
  version: z.number().int().min(1),
  reviewRevision: z.number().int().min(0),
  feedback: FeedbackSchema.refine(
    (feedback) => plainTextExcerpt(feedback, 1) !== '',
    'feedback must have some text',
  ),
});

export type IRequestResubmissionInput = z.output<
  typeof RequestResubmissionInputSchema
>;

export const AmendGradeInputSchema = StudentRefSchema.extend({
  reviewRevision: z.number().int().min(0),
  points: PointsSchema,
  feedback: FeedbackSchema.optional(),
});

export type IAmendGradeInput = z.output<typeof AmendGradeInputSchema>;

export const GradingWriteOutputSchema = z.object({
  reviewRevision: z.number().int(),
});
