/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { assessmentStatement } from '@discava/common-server-utils/certificate-statement';
import {
  type Certificate,
  type CoreTable,
  formatCertificateId,
  InvalidRequestError,
  normaliseCertificateId,
  restoreCertificate as restoreStoredCertificate,
  revokeCertificate as revokeStoredCertificate,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { adminProcedure } from '../init.js';
import {
  CertificateRecordSchema,
  GetCertificateInputSchema,
  type ICertificateRecord,
  RestoreCertificateInputSchema,
  RevokeCertificateInputSchema,
} from '../schema/index.js';

const DEFAULT_ACTOR_NAME = 'Unknown user';

// One error for a malformed and an unknown ID, as certificate.verify gives.
const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Certificate not found' });

const findByCertificateId = async (coreTable: CoreTable, input: string) => {
  const certificateId = normaliseCertificateId(input);
  if (!certificateId) {
    throw notFound();
  }
  const {
    data: [certificate],
  } = await coreTable.entities.certificate.query
    .byCertificateId({ certificateId })
    .go();
  if (!certificate) {
    throw notFound();
  }
  return certificate;
};

// Two keyed reads: the certificate's events, then the names of their actors.
const toRecord = async (
  coreTable: CoreTable,
  certificate: Certificate,
): Promise<ICertificateRecord> => {
  const { data: events } = await coreTable.entities.certificateEvent.query
    .primary({ userId: certificate.userId, courseId: certificate.courseId })
    .go({ pages: 'all' });
  const actorIds = [...new Set(events.map((e) => e.actorId))];
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
  return {
    certificateId: formatCertificateId(certificate.certificateId),
    learnerName: certificate.learnerName,
    courseId: certificate.courseId,
    courseTitle: certificate.courseTitle,
    completedAt: certificate.completedAt,
    issuedAt: certificate.issuedAt,
    statement: assessmentStatement(certificate.assessment),
    status: certificate.revokedAt ? 'revoked' : 'valid',
    ...(certificate.revokedAt && {
      revokedAt: certificate.revokedAt,
      revocationReason: certificate.revocationReason,
      revokedByRole: certificate.revokedByRole,
    }),
    history: [...events]
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .map((event) => ({
        type: event.type,
        occurredAt: event.occurredAt,
        ...(event.reason && { reason: event.reason }),
        ...(event.note && { note: event.note }),
        actorRole: event.actorRole,
        actorName: names.get(event.actorId) ?? DEFAULT_ACTOR_NAME,
      })),
  };
};

export const getCertificate = adminProcedure
  .input(GetCertificateInputSchema)
  .output(CertificateRecordSchema)
  .query(async ({ ctx, input }) =>
    toRecord(
      ctx.coreTable,
      await findByCertificateId(ctx.coreTable, input.certificateId),
    ),
  );

// Any of the four reasons, `refunded` included. Choosing it is the
// administrator's statement: orders are not looked at.
export const revokeCertificate = adminProcedure
  .input(RevokeCertificateInputSchema)
  .output(CertificateRecordSchema)
  .mutation(async ({ ctx, input }) => {
    const certificate = await findByCertificateId(
      ctx.coreTable,
      input.certificateId,
    );
    try {
      return toRecord(
        ctx.coreTable,
        await revokeStoredCertificate({
          coreTable: ctx.coreTable,
          certificate,
          actor: { id: ctx.user.sub, role: 'admin' },
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

// Restores whoever revoked it.
export const restoreCertificate = adminProcedure
  .input(RestoreCertificateInputSchema)
  .output(CertificateRecordSchema)
  .mutation(async ({ ctx, input }) => {
    const certificate = await findByCertificateId(
      ctx.coreTable,
      input.certificateId,
    );
    try {
      return toRecord(
        ctx.coreTable,
        await restoreStoredCertificate({
          coreTable: ctx.coreTable,
          certificate,
          actor: { id: ctx.user.sub, role: 'admin' },
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
