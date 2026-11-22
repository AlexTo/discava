/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import {
  evaluateCertificateCriteria,
  filterEffectivelyVisible,
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
  CertificateRequirementsInputSchema,
  CertificateRequirementsOutputSchema,
  type IRevocationReason,
  MyCertificatesInputSchema,
  MyCertificatesOutputSchema,
  RecordLinkedInClickInputSchema,
  RecordLinkedInClickOutputSchema,
  VerifyCertificateInputSchema,
  VerifyCertificateOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

// One message for a malformed and an unknown ID, so a caller can't tell them
// apart.
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Certificate not found' });

// What a learner is told of a certificate's state. The role that revoked it
// and any note stay private.
const certificateStatus = (certificate: {
  revokedAt?: string;
  revocationReason?: IRevocationReason;
}) =>
  certificate.revokedAt
    ? {
        status: 'revoked' as const,
        revokedAt: certificate.revokedAt,
        ...(certificate.revocationReason && {
          revocationReason: certificate.revocationReason,
        }),
      }
    : { status: 'valid' as const };

/**
 * Public: the details printed on a certificate, looked up by its ID. Returns
 * only those fields and the statement of what was assessed, never the
 * student's id, the course's id, the assessed items or anything else on the
 * record. A revoked certificate returns only its ID and the date.
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

    if (certificate.revokedAt) {
      return {
        status: 'revoked' as const,
        certificateId: formatCertificateId(certificate.certificateId),
        revokedAt: certificate.revokedAt,
        revokedOn: formatDate(certificate.revokedAt),
      };
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
        ...certificateStatus(certificate),
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

    if (certificate.revokedAt) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This certificate has been revoked',
      });
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

/**
 * What the caller still needs for a course's certificate. The requirements
 * are `evaluateCertificateCriteria`'s; this only adds completion of every
 * item and the quizzes' titles and lessons. Reads the caller's own records
 * and writes nothing.
 */
export const certificateRequirements = courseProcedure
  .input(CertificateRequirementsInputSchema)
  .output(CertificateRequirementsOutputSchema)
  .query(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const userId = ctx.user.sub;
    const { courseId } = input;

    const [
      { data: curriculum },
      enrolment,
      { data: certificate },
      { data: completions },
      { data: summaries },
    ] = await Promise.all([
      coreTable.collections.curriculum({ courseId }).go({ pages: 'all' }),
      getEnrolment(coreTable, courseId, userId),
      coreTable.entities.certificate.get({ userId, courseId }).go(),
      coreTable.entities.itemCompletion.query
        .primary({ userId, courseId })
        .go({ pages: 'all' }),
      coreTable.entities.quizSummary.query
        .primary({ userId })
        .where(({ courseId: id }, { eq }) => eq(id, courseId))
        .go({ pages: 'all' }),
    ]);
    const [course] = curriculum.course;
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);

    const issued = certificate
      ? {
          certificateId: formatCertificateId(certificate.certificateId),
          ...certificateStatus(certificate),
        }
      : null;
    if (!course.certificatesEnabled) {
      return {
        certificatesEnabled: false,
        certificate: issued,
        allMet: false,
        requirements: [],
      };
    }

    const content = {
      modules: curriculum.module,
      lessons: curriculum.lesson,
      contentItems: curriculum.contentItem,
    };
    const visibleItems = filterEffectivelyVisible(content).contentItems;
    const completed = new Set(completions.map((c) => c.contentItemId));
    const complete = {
      kind: 'complete-items' as const,
      met: enrolment!.status === 'completed',
      done: visibleItems.filter((i) => completed.has(i.contentItemId)).length,
      total: visibleItems.length,
    };

    const evaluation = evaluateCertificateCriteria({
      criteria: course.certificateCriteria,
      curriculum: content,
      quizSummaries: summaries,
    });
    const itemsById = new Map(
      visibleItems.map((item) => [item.contentItemId, item]),
    );
    const requirements = [
      complete,
      ...evaluation.requirements.map(({ quizzes }) => {
        const items = quizzes.map(({ contentItemId, state }) => ({
          contentItemId,
          lessonId: itemsById.get(contentItemId)?.lessonId ?? '',
          title: itemsById.get(contentItemId)?.title ?? '',
          state,
        }));
        const done = items.filter((i) => i.state === 'passed').length;
        return {
          kind: 'pass-quizzes' as const,
          met: done === items.length,
          done,
          total: items.length,
          items,
        };
      }),
    ];
    return {
      certificatesEnabled: true,
      certificate: issued,
      allMet: requirements.every((r) => r.met),
      requirements,
    };
  });
