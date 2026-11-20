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
export const VerifyCertificateOutputSchema = z.object({
  certificateId: z.string(),
  learnerName: z.string(),
  courseTitle: z.string(),
  completedAt: z.string(),
  // `completedAt` as the PDF prints it (UTC, e.g. `19 November 2026`).
  completedOn: z.string(),
});

export type IVerifyCertificateOutput = z.output<
  typeof VerifyCertificateOutputSchema
>;

export const MyCertificatesInputSchema = z.void();

export const MyCertificateSchema = z.object({
  certificateId: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),
  learnerName: z.string(),
  completedAt: z.string(),
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
