/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import {
  formatCertificateId,
  normaliseCertificateId,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { drawCertificatePdf, formatDate } from '../helpers/certificate-pdf.js';
import { courseProcedure, publicCourseProcedure } from '../init.js';
import {
  CertificatePdfInputSchema,
  CertificatePdfOutputSchema,
  MyCertificatesInputSchema,
  MyCertificatesOutputSchema,
  VerifyCertificateInputSchema,
  VerifyCertificateOutputSchema,
} from '../schema/index.js';

// One message for a malformed and an unknown ID, so a caller can't tell them
// apart.
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Certificate not found' });

/**
 * Public: the details printed on a certificate, looked up by its ID. Returns
 * only those fields, never the student's id, the course's id or anything
 * else on the record.
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
      certificateId: formatCertificateId(certificate.certificateId),
      learnerName: certificate.learnerName,
      courseTitle: certificate.courseTitle,
      completedAt: certificate.completedAt,
      completedOn: formatDate(certificate.completedAt),
    };
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
    });

    return {
      fileName: `certificate-${displayId}.pdf`,
      contentBase64: Buffer.from(bytes).toString('base64'),
    };
  });
