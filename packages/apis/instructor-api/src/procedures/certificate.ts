/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type Certificate,
  type CoreTable,
  formatCertificateId,
  InvalidRequestError,
  normaliseCertificateId,
  RestoreForbiddenError,
  restoreCertificate as restoreStoredCertificate,
  revokeCertificate as revokeStoredCertificate,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseInstructorProcedure } from '../init.js';
import {
  CertificateHistoryInputSchema,
  CertificateHistoryOutputSchema,
  CourseCertificateSchema,
  ListCertificatesInputSchema,
  ListCertificatesOutputSchema,
  RestoreCertificateInputSchema,
  RevokeCertificateInputSchema,
} from '../schema/index.js';

const PAGE_SIZE = 50;
const DEFAULT_ACTOR_NAME = 'Instructor';

// One error for a malformed ID, an unknown one and another course's, so an ID
// of another course is not confirmed.
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Certificate not found' });

const toItem = (certificate: Certificate) => ({
  certificateId: formatCertificateId(certificate.certificateId),
  learnerName: certificate.learnerName,
  completedAt: certificate.completedAt,
  issuedAt: certificate.issuedAt,
  status: certificate.revokedAt ? ('revoked' as const) : ('valid' as const),
  ...(certificate.revokedAt && {
    revokedAt: certificate.revokedAt,
    revocationReason: certificate.revocationReason,
    revokedByRole: certificate.revokedByRole,
  }),
  canRestore:
    certificate.revokedAt !== undefined &&
    certificate.revokedByRole !== 'admin',
});

// The course's certificate with this ID: NOT_FOUND when it is malformed,
// unknown or of another course.
const findCertificate = async (
  coreTable: CoreTable,
  courseId: string,
  input: string,
) => {
  const certificateId = normaliseCertificateId(input);
  if (!certificateId) {
    throw notFound();
  }
  const {
    data: [certificate],
  } = await coreTable.entities.certificate.query
    .byCertificateId({ certificateId })
    .go();
  if (!certificate || certificate.courseId !== courseId) {
    throw notFound();
  }
  return certificate;
};

// Allowed at any course status. No `userId` or email is returned.
export const listCertificates = courseInstructorProcedure(
  ListCertificatesInputSchema,
)
  .output(ListCertificatesOutputSchema)
  .query(async ({ ctx, input }) => {
    let page: Awaited<
      ReturnType<
        ReturnType<
          typeof ctx.coreTable.entities.certificate.query.byCourse
        >['go']
      >
    >;
    try {
      page = await ctx.coreTable.entities.certificate.query
        .byCourse({ courseId: input.courseId })
        .go({ order: 'desc', limit: PAGE_SIZE, cursor: input.cursor });
    } catch (error) {
      if (input.cursor !== undefined) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'cursor is not valid',
        });
      }
      throw error;
    }
    return {
      items: page.data.map(toItem),
      ...(page.cursor && { nextCursor: page.cursor }),
    };
  });

// Oldest first. An administrator's actions show as "An administrator", so an
// instructor does not learn which one acted.
export const certificateHistory = courseInstructorProcedure(
  CertificateHistoryInputSchema,
)
  .output(CertificateHistoryOutputSchema)
  .query(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const certificate = await findCertificate(
      coreTable,
      input.courseId,
      input.certificateId,
    );
    const { data: events } = await coreTable.entities.certificateEvent.query
      .primary({ userId: certificate.userId, courseId: certificate.courseId })
      .go({ pages: 'all' });

    const actorIds = [
      ...new Set(
        events
          .filter((e) => e.actorRole === 'instructor')
          .map((e) => e.actorId),
      ),
    ];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: users } = await coreTable.entities.user
        .get(actorIds.map((userId) => ({ userId })))
        .go();
      for (const user of users) {
        const name = `${user.givenName ?? ''} ${user.familyName ?? ''}`.trim();
        names.set(user.userId, name || DEFAULT_ACTOR_NAME);
      }
    }
    return [...events]
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((event) => ({
        type: event.type,
        occurredAt: event.occurredAt,
        ...(event.reason && { reason: event.reason }),
        ...(event.note && { note: event.note }),
        actorRole: event.actorRole,
        actorName:
          event.actorRole === 'admin'
            ? 'An administrator'
            : (names.get(event.actorId) ?? DEFAULT_ACTOR_NAME),
      }));
  });

// Already revoked: the stored state comes back with no second event.
export const revokeCertificate = courseInstructorProcedure(
  RevokeCertificateInputSchema,
)
  .output(CourseCertificateSchema)
  .mutation(async ({ ctx, input }) => {
    const certificate = await findCertificate(
      ctx.coreTable,
      input.courseId,
      input.certificateId,
    );
    try {
      return toItem(
        await revokeStoredCertificate({
          coreTable: ctx.coreTable,
          certificate,
          actor: { id: ctx.user.sub, role: 'instructor' },
          reason: input.reason,
          note: input.note,
          now: new Date(),
        }),
      );
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }
  });

// FORBIDDEN when an administrator revoked it; already valid comes back as it
// is, with no event.
export const restoreCertificate = courseInstructorProcedure(
  RestoreCertificateInputSchema,
)
  .output(CourseCertificateSchema)
  .mutation(async ({ ctx, input }) => {
    const certificate = await findCertificate(
      ctx.coreTable,
      input.courseId,
      input.certificateId,
    );
    try {
      return toItem(
        await restoreStoredCertificate({
          coreTable: ctx.coreTable,
          certificate,
          actor: { id: ctx.user.sub, role: 'instructor' },
          note: input.note,
          now: new Date(),
        }),
      );
    } catch (error) {
      if (error instanceof RestoreForbiddenError) {
        throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
      }
      if (error instanceof InvalidRequestError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      }
      throw error;
    }
  });
