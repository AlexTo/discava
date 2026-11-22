/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const VerifyCertificateInputSchema = z.object({
  // Any case, with or without dashes or spaces; normalised by the procedure.
  certificateId: z.string().max(100),
});

export type IVerifyCertificateInput = z.output<
  typeof VerifyCertificateInputSchema
>;

// Public: exactly what a verifier may see, nothing that identifies the
// student's account or course record.
export const VerifyCertificateOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('valid'),
    certificateId: z.string(),
    learnerName: z.string(),
    courseTitle: z.string(),
    completedAt: z.string(),
    // `completedAt` as the PDF prints it (UTC, e.g. `19 November 2026`).
    completedOn: z.string(),
    // What the certificate confirms, one line each; the PDF draws the same.
    statement: z.array(z.string()).min(1),
  }),
  // Nothing identifies the learner or the course, and no reason is given.
  z.object({
    status: z.literal('revoked'),
    certificateId: z.string(),
    revokedAt: z.string(),
    // `revokedAt` formatted like `completedOn`.
    revokedOn: z.string(),
  }),
]);

export type IVerifyCertificateOutput = z.output<
  typeof VerifyCertificateOutputSchema
>;

export const RecordLinkedInClickInputSchema = z.object({
  // Any case, with or without dashes or spaces, as certificate.verify takes it.
  certificateId: z.string().max(64),
  source: z.enum([
    'my-learning',
    'certificate-page',
    'issued-email',
    'reminder-email',
  ]),
});

export type IRecordLinkedInClickInput = z.output<
  typeof RecordLinkedInClickInputSchema
>;

// Nothing from the certificate comes back.
export const RecordLinkedInClickOutputSchema = z.object({});

export const CertificateStatusSchema = z.enum(['valid', 'revoked']);

// Why a certificate was revoked, as stored. The learner sees its label.
export const RevocationReasonSchema = z.enum([
  'academic-integrity',
  'issued-in-error',
  'other',
  'refunded',
]);

export type IRevocationReason = z.output<typeof RevocationReasonSchema>;

export const MyCertificatesInputSchema = z.void();

export const MyCertificateSchema = z.object({
  certificateId: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),
  learnerName: z.string(),
  completedAt: z.string(),
  status: CertificateStatusSchema,
  revokedAt: z.string().optional(),
  revocationReason: RevocationReasonSchema.optional(),
});

export type IMyCertificate = z.output<typeof MyCertificateSchema>;

export const MyCertificatesOutputSchema = z.array(MyCertificateSchema);

export const CertificatePdfInputSchema = z.object({
  courseId: z.string(),
});

export type ICertificatePdfInput = z.output<typeof CertificatePdfInputSchema>;

export const CertificatePdfOutputSchema = z.object({
  fileName: z.string(),
  contentBase64: z.string(),
});

export type ICertificatePdfOutput = z.output<typeof CertificatePdfOutputSchema>;

export const CertificateRequirementsInputSchema = z.object({
  courseId: z.string(),
});

export type ICertificateRequirementsInput = z.output<
  typeof CertificateRequirementsInputSchema
>;

export const QuizRequirementItemSchema = z.object({
  contentItemId: z.string(),
  lessonId: z.string(),
  title: z.string(),
  state: z.enum(['passed', 'not-attempted', 'not-passed', 'no-attempts-left']),
});

export const UploadRequirementItemSchema = z.object({
  contentItemId: z.string(),
  lessonId: z.string(),
  title: z.string(),
  state: z.enum(['met', 'not-submitted', 'awaiting-grade', 'below-score']),
  // The caller's returned score, once there is one.
  scorePercent: z.number().optional(),
});

export type IUploadRequirementItem = z.output<
  typeof UploadRequirementItemSchema
>;

export type IQuizRequirementItem = z.output<typeof QuizRequirementItemSchema>;

// What the caller still needs for the certificate of one course. Their own
// data only.
export const CertificateRequirementsOutputSchema = z.object({
  certificatesEnabled: z.boolean(),
  certificate: z
    .object({
      certificateId: z.string(),
      status: CertificateStatusSchema,
      revokedAt: z.string().optional(),
      revocationReason: RevocationReasonSchema.optional(),
    })
    .nullable(),
  allMet: z.boolean(),
  requirements: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('complete-items'),
        met: z.boolean(),
        done: z.number(),
        total: z.number(),
      }),
      z.object({
        kind: z.literal('pass-quizzes'),
        met: z.boolean(),
        done: z.number(),
        total: z.number(),
        items: z.array(QuizRequirementItemSchema),
      }),
      z.object({
        kind: z.literal('graded-uploads'),
        met: z.boolean(),
        done: z.number(),
        total: z.number(),
        minScorePercent: z.number(),
        items: z.array(UploadRequirementItemSchema),
      }),
    ]),
  ),
});

export type ICertificateRequirementsOutput = z.output<
  typeof CertificateRequirementsOutputSchema
>;
