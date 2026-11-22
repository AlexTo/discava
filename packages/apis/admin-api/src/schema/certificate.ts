/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

export const RevocationReasonSchema = z.enum([
  'academic-integrity',
  'issued-in-error',
  'other',
  'refunded',
]);

export const GetCertificateInputSchema = z.object({
  // Any case, with or without dashes or spaces.
  certificateId: z.string().max(100),
});

export const CertificateRecordSchema = z.object({
  certificateId: z.string(),
  learnerName: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),
  completedAt: z.string(),
  issuedAt: z.string(),
  // As the public page prints it.
  statement: z.array(z.string()),
  status: z.enum(['valid', 'revoked']),
  revokedAt: z.string().optional(),
  revocationReason: RevocationReasonSchema.optional(),
  revokedByRole: z.enum(['instructor', 'admin']).optional(),
  history: z.array(
    z.object({
      type: z.enum(['revoked', 'restored']),
      occurredAt: z.string(),
      reason: RevocationReasonSchema.optional(),
      note: z.string().optional(),
      actorRole: z.enum(['instructor', 'admin']),
      actorName: z.string(),
    }),
  ),
});

export type ICertificateRecord = z.output<typeof CertificateRecordSchema>;

export const RevokeCertificateInputSchema = z.object({
  certificateId: z.string().max(100),
  reason: RevocationReasonSchema,
  // At most 500 characters; required for `other`.
  note: z.string().max(500).optional(),
});

export const RestoreCertificateInputSchema = z.object({
  certificateId: z.string().max(100),
  note: z.string().max(500).optional(),
});
