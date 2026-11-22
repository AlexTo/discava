/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// The reasons an instructor may give. `refunded` is the administrator's alone.
export const InstructorRevocationReasonSchema = z.enum([
  'academic-integrity',
  'issued-in-error',
  'other',
]);

const StoredRevocationReasonSchema = z.enum([
  'academic-integrity',
  'issued-in-error',
  'other',
  'refunded',
]);

export const CertificateNoteSchema = z.string().max(500);

export const ListCertificatesInputSchema = z.object({
  courseId: z.string(),
  cursor: z.string().min(1).optional(),
});

export const CourseCertificateSchema = z.object({
  certificateId: z.string(),
  learnerName: z.string(),
  completedAt: z.string(),
  issuedAt: z.string(),
  status: z.enum(['valid', 'revoked']),
  revokedAt: z.string().optional(),
  revocationReason: StoredRevocationReasonSchema.optional(),
  revokedByRole: z.enum(['instructor', 'admin']).optional(),
  // False for a valid certificate and for one an administrator revoked.
  canRestore: z.boolean(),
});

export type ICourseCertificate = z.output<typeof CourseCertificateSchema>;

export const ListCertificatesOutputSchema = z.object({
  items: z.array(CourseCertificateSchema),
  nextCursor: z.string().optional(),
});

export const CertificateHistoryInputSchema = z.object({
  courseId: z.string(),
  certificateId: z.string().max(100),
});

export const CertificateHistoryOutputSchema = z.array(
  z.object({
    type: z.enum(['revoked', 'restored']),
    occurredAt: z.string(),
    reason: StoredRevocationReasonSchema.optional(),
    note: z.string().optional(),
    actorRole: z.enum(['instructor', 'admin']),
    // "An administrator" for an administrator's action.
    actorName: z.string(),
  }),
);

export const RevokeCertificateInputSchema = z.object({
  courseId: z.string(),
  certificateId: z.string().max(100),
  reason: InstructorRevocationReasonSchema,
  // Required for `other`.
  note: CertificateNoteSchema.optional(),
});

export const RestoreCertificateInputSchema = z.object({
  courseId: z.string(),
  certificateId: z.string().max(100),
  note: CertificateNoteSchema.optional(),
});
