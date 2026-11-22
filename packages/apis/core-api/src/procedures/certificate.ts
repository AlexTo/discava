/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import {
  formatCertificateId,
  normaliseCertificateId,
  recordLinkedInClick as recordCertificateLinkedInClick,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { drawCertificatePdf, formatDate } from '../helpers/certificate-pdf.js';
import { assessmentStatement } from '../helpers/certificate-statement.js';
import { courseProcedure, publicCourseProcedure } from '../init.js';
import {
  CertificatePdfInputSchema,
  CertificatePdfOutputSchema,
  MyCertificatesInputSchema,
  MyCertificatesOutputSchema,
  RecordLinkedInClickInputSchema,
  RecordLinkedInClickOutputSchema,
  VerifyCertificateInputSchema,
  VerifyCertificateOutputSchema,
} from '../schema/index.js';

// One message for a malformed and an unknown ID, so a caller can't tell them
// apart.
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Certificate not found' });

/**
 * Public: the details printed on a certificate, looked up by its ID. Returns
 * only those fields and the statement of what was assessed, never the
 * student's id, the course's id, the assessed items or anything else on the
 * record.
 */
export const verifyCertificate = publicCourseProcedure
  .input(VerifyCertificateInputSchema)
  .output(VerifyCertificateOutputSchema)
  .query(async ({ ctx, input }) => {
    const certificateId = normaliseCertificateId(input.certificateId);
    if (!certificateId) {
      throw notFound();
    }

    const { data } = await ctx.coreTable.entities.certificate.query
      .byCertificateId({ certificateId })
      .go();
    const [certificate] = data;
    if (!certificate) {
      throw notFound();
    }

    return {
      status: 'valid' as const,
      certificateId: formatCertificateId(certificate.certificateId),
      learnerName: certificate.learnerName,
      courseTitle: certificate.courseTitle,
      completedAt: certificate.completedAt,
      completedOn: formatDate(certificate.completedAt),
      statement: assessmentStatement(certificate.assessment),
    };
  });

/**
 * Public: records the first use of "Add to LinkedIn profile" on a certificate.
 * Later uses change nothing and answer the same. The caller's identity isn't
 * read, and nothing is sent to LinkedIn.
 */
export const recordLinkedInClick = publicCourseProcedure
  .input(RecordLinkedInClickInputSchema)
  .output(RecordLinkedInClickOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const result = await recordCertificateLinkedInClick({
      coreTable: ctx.coreTable,
      certificateId: input.certificateId,
      source: input.source,
      now: new Date(),
    });
    if (!result) {
      throw notFound();
    }
    return {};
  });

/** The caller's certificates, most recently completed first. */
export const myCertificates = courseProcedure
  .input(MyCertificatesInputSchema)
  .output(MyCertificatesOutputSchema)
  .query(async ({ ctx }) => {
    const { data } = await ctx.coreTable.entities.certificate.query
      .primary({ userId: ctx.user.sub })
      .go({ pages: 'all' });

    return data
      .map((certificate) => ({
        certificateId: formatCertificateId(certificate.certificateId),
        courseId: certificate.courseId,
        courseTitle: certificate.courseTitle,
        learnerName: certificate.learnerName,
        completedAt: certificate.completedAt,
      }))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  });

/**
 * The caller's certificate for a course as a PDF, drawn on demand from the
 * certificate record alone (so it works for an archived course, or with
 * certificates since turned off). Another student's course is NOT_FOUND, the
 * same as a course with no certificate.
 */
export const certificatePdf = courseProcedure
  .input(CertificatePdfInputSchema)
  .output(CertificatePdfOutputSchema)
  .query(async ({ ctx, input }) => {
    const { data: certificate } = await ctx.coreTable.entities.certificate
      .get({
        userId: ctx.user.sub,
        courseId: input.courseId,
      })
      .go();
    if (!certificate) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const displayId = formatCertificateId(certificate.certificateId);
    // The caller is the student portal, so its origin is the site to verify
    // on; with none known the PDF prints the path and the site name.
    const origin = getAllowedOrigin(ctx.event);
    const verifyUrl = origin
      ? `${origin}/certificates/${displayId}`
      : `Discava /certificates/${displayId}`;

    const bytes = await drawCertificatePdf({
      learnerName: certificate.learnerName,
      courseTitle: certificate.courseTitle,
      completedAt: certificate.completedAt,
      certificateId: displayId,
      verifyUrl,
      statement: assessmentStatement(certificate.assessment),
    });

    return {
      fileName: `certificate-${displayId}.pdf`,
      contentBase64: Buffer.from(bytes).toString('base64'),
    };
  });
