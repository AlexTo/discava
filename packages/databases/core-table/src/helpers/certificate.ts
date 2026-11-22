/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import type { EntityItem } from 'electrodb';
import type { createCertificateEntity } from '../entities/certificate.js';
import type { createCourseEntity } from '../entities/course.js';
import type { createEnrolmentEntity } from '../entities/enrolment.js';
import type { createUserEntity } from '../entities/user.js';
import type { createCoreTableService } from '../service.js';
import type { CertificateEvaluation } from './certificate-criteria.js';
import {
  cancellationReasons,
  failedAt,
  hasFailedCondition,
  hasTransactionConflict,
  InvalidRequestError,
  isConditionalCheckFailed,
  VersionConflictError,
} from './errors.js';
import {
  notificationWrites,
  publishNotification,
  transactionEntities,
} from './notification.js';

// Crockford's base32: no I, L, O or U, so an ID read aloud or copied by hand
// can't be mistaken.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 16;
const MAX_ID_TRIES = 5;
const MAX_WRITE_RETRIES = 3;
export const LINKEDIN_CLICK_SOURCES = [
  'my-learning',
  'certificate-page',
  'issued-email',
  'reminder-email',
] as const;
export type LinkedInClickSource = (typeof LINKEDIN_CLICK_SOURCES)[number];

export const CERTIFICATE_REMINDER_DELAY_DAYS = 3;

const FALLBACK_NAME = 'Discava learner';

// 10 random bytes are 80 bits: exactly 16 base32 characters.
export const generateCertificateId = (): string => {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const byte of bytes) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let id = '';
  for (let i = ID_LENGTH - 1; i >= 0; i--) {
    id += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  }
  return id;
};

// XXXX-XXXX-XXXX-XXXX, for display.
export const formatCertificateId = (id: string): string =>
  id.match(/.{1,4}/g)?.join('-') ?? id;

// The stored ID for what someone typed: dashes and spaces dropped, uppercased,
// and the look-alikes Crockford defines mapped (O to 0, I and L to 1).
// Undefined unless the result is exactly 16 characters of the alphabet.
export const normaliseCertificateId = (input: string): string | undefined => {
  const id = input
    .replace(/[-\s]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return id.length === ID_LENGTH && [...id].every((c) => ALPHABET.includes(c))
    ? id
    : undefined;
};

// The name printed on a certificate: given and family names, never the email.
export const learnerName = (
  user:
    | { givenName?: string | null; familyName?: string | null }
    | null
    | undefined,
): string =>
  [user?.givenName, user?.familyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ') || FALLBACK_NAME;

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type Item<F extends () => Promise<any>> = EntityItem<Awaited<ReturnType<F>>>;
export type Certificate = Item<typeof createCertificateEntity>;

export interface IssueCertificateInput {
  coreTable: CoreTable;
  enrolment: Pick<
    Item<typeof createEnrolmentEntity>,
    'userId' | 'courseId' | 'status' | 'completedAt'
  >;
  course: Pick<
    Item<typeof createCourseEntity>,
    'courseId' | 'title' | 'certificatesEnabled' | 'durationHours'
  >;
  // What the criteria say of this student (evaluateCertificateCriteria).
  evaluation: CertificateEvaluation;
  user: Pick<Item<typeof createUserEntity>, 'givenName' | 'familyName'> | null;
  now: Date;
}

// Issues the student's certificate for a course once they've completed it and
// met its criteria (`evaluation.met`; none is issued otherwise), and returns it; returns the one already issued if there is one, so it's safe
// to call again (a retried stream batch) or at the same time as another
// caller. The certificate and its `certificate.issued` notification are one
// transaction: the certificate's create is conditioned on the key not
// existing, and the loser reads the winner's record. A notification state
// that moved meanwhile cancels the transaction, which is built and tried again.
export const issueCertificate = async ({
  coreTable,
  enrolment,
  course,
  evaluation,
  user,
  now,
}: IssueCertificateInput): Promise<Certificate | undefined> => {
  const { completedAt } = enrolment;
  if (
    enrolment.status !== 'completed' ||
    !completedAt ||
    course.certificatesEnabled === false
  ) {
    return undefined;
  }

  const { certificate } = coreTable.entities;
  const key = { userId: enrolment.userId, courseId: enrolment.courseId };
  const { data: existing } = await certificate.get(key).go();
  if (existing) {
    return existing;
  }
  if (!evaluation.met) {
    return undefined;
  }

  let certificateId: string | undefined;
  for (let tries = 0; tries < MAX_ID_TRIES && !certificateId; tries++) {
    const candidate = generateCertificateId();
    const { data: taken } = await certificate.query
      .byCertificateId({ certificateId: candidate })
      .go();
    if (taken.length === 0) {
      certificateId = candidate;
    }
  }
  if (!certificateId) {
    throw new Error(`No unused certificate ID found in ${MAX_ID_TRIES} tries`);
  }

  const issuedAt = now.toISOString();
  for (let attempt = 0; attempt <= MAX_WRITE_RETRIES; attempt++) {
    const items = [
      transactionEntities(coreTable)
        .certificate.create({
          ...key,
          certificateId,
          learnerName: learnerName(user),
          courseTitle: course.title,
          completedAt,
          issuedAt,
          assessment: {
            ...evaluation.assessment,
            ...(course.durationHours !== undefined && {
              courseHours: course.durationHours,
            }),
          },
        })
        .commit(),
      ...(await notificationWrites(coreTable, {
        type: 'certificate.issued',
        userId: key.userId,
        params: {
          certificateId: formatCertificateId(certificateId),
          courseTitle: course.title,
        },
        dedupeKey: certificateId,
        occurredAt: issuedAt,
      })),
    ];
    const { canceled, data } = await coreTable.transaction
      .write(() => items)
      .go();
    if (!canceled) {
      const { data: created } = await certificate.get(key).go();
      if (!created) {
        throw new Error('The issued certificate could not be read back');
      }
      return created;
    }
    const reasons = cancellationReasons(data);
    // Item 0 is the certificate's create: its condition failing means
    // another caller issued it first.
    if (failedAt(reasons, 0)) {
      const { data: winner } = await certificate.get(key).go();
      if (winner) {
        return winner;
      }
    }
    if (!hasFailedCondition(reasons) && !hasTransactionConflict(reasons)) {
      throw new Error('The certificate transaction was cancelled');
    }
  }
  throw new VersionConflictError();
};

export interface RecordLinkedInClickInput {
  coreTable: Pick<CoreTable, 'entities'>;
  certificateId: string;
  source: LinkedInClickSource;
  now: Date;
}

// Records the first use of "Add to LinkedIn profile" on a certificate. Later
// calls, or one at the same moment as another, change nothing. Undefined for a
// malformed or unknown ID, and for a revoked certificate, which records nothing.
export const recordLinkedInClick = async ({
  coreTable,
  certificateId,
  source,
  now,
}: RecordLinkedInClickInput): Promise<
  'recorded' | 'already-recorded' | undefined
> => {
  const id = normaliseCertificateId(certificateId);
  if (!id) {
    return undefined;
  }
  const { certificate } = coreTable.entities;
  const {
    data: [found],
  } = await certificate.query.byCertificateId({ certificateId: id }).go();
  if (!found || found.revokedAt) {
    return undefined;
  }
  try {
    await certificate
      .patch({ userId: found.userId, courseId: found.courseId })
      .set({
        linkedInClickedAt: now.toISOString(),
        linkedInClickSource: source,
      })
      .where(
        (attr, op) =>
          `${op.notExists(attr.linkedInClickedAt)} AND ${op.notExists(attr.revokedAt)}`,
      )
      .go();
    return 'recorded';
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    return 'already-recorded';
  }
};

// When the one reminder to add the certificate to LinkedIn is due.
export const certificateReminderDueAt = (
  certificate: Pick<Certificate, 'issuedAt'>,
): string =>
  new Date(
    Date.parse(certificate.issuedAt) +
      CERTIFICATE_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

export interface CertificateReminderInput {
  coreTable: Pick<CoreTable, 'entities'>;
  userId: string;
  courseId: string;
  now: Date;
}

// Records that the reminder's schedule exists, once. A failed condition means
// it was already recorded, which is fine.
export const markCertificateReminderScheduled = async ({
  coreTable,
  userId,
  courseId,
  now,
}: CertificateReminderInput): Promise<void> => {
  try {
    await coreTable.entities.certificate
      .patch({ userId, courseId })
      .set({ reminderScheduledAt: now.toISOString() })
      .where((attr, op) => op.notExists(attr.reminderScheduledAt))
      .go();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }
};

// Claims the reminder for sending: `reminderSentAt` is set once, and only
// while no LinkedIn use is recorded. Returns the certificate and the stored
// `reminderSentAt` when the reminder is to be published (a claim made by an
// earlier run is read back, so a retry publishes with the same time), and
// undefined when there is no certificate, a click won, or it is revoked.
export const claimCertificateReminder = async ({
  coreTable,
  userId,
  courseId,
  now,
}: CertificateReminderInput): Promise<
  { certificate: Certificate; reminderSentAt: string } | undefined
> => {
  const { certificate } = coreTable.entities;
  const key = { userId, courseId };
  const { data: existing } = await certificate.get(key).go();
  if (!existing || existing.revokedAt) {
    return undefined;
  }
  if (existing.reminderSentAt) {
    return { certificate: existing, reminderSentAt: existing.reminderSentAt };
  }
  const reminderSentAt = now.toISOString();
  try {
    await certificate
      .patch(key)
      .set({ reminderSentAt })
      .where(
        (attr, op) =>
          `${op.notExists(attr.reminderSentAt)} AND ${op.notExists(attr.linkedInClickedAt)} AND ${op.notExists(attr.revokedAt)}`,
      )
      .go();
    return { certificate: { ...existing, reminderSentAt }, reminderSentAt };
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
  }
  const { data: current } = await certificate.get(key).go();
  return current?.reminderSentAt && !current.revokedAt
    ? { certificate: current, reminderSentAt: current.reminderSentAt }
    : undefined;
};

export const REVOCATION_REASONS = [
  'academic-integrity',
  'issued-in-error',
  'other',
  'refunded',
] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export const REVOCATION_NOTE_MAX_LENGTH = 500;

const REVOCATION_REASON_LABELS: Record<RevocationReason, string> = {
  'academic-integrity': 'Academic integrity',
  'issued-in-error': 'Issued in error',
  refunded: 'Order refunded',
  other: 'Other',
};

// The reason as a learner is shown it.
export const revocationReasonLabel = (reason: RevocationReason): string =>
  REVOCATION_REASON_LABELS[reason];

export type CertificateActor = { id: string; role: 'instructor' | 'admin' };

// An instructor tried to restore a certificate an administrator revoked.
export class RestoreForbiddenError extends Error {
  constructor(message = 'An administrator revoked this certificate') {
    super(message);
    this.name = 'RestoreForbiddenError';
  }
}

export interface RevokeCertificateInput {
  coreTable: CoreTable;
  certificate: Certificate;
  actor: CertificateActor;
  reason: RevocationReason;
  note?: string;
  now: Date;
}

const checkNote = (note: string | undefined) => {
  if (note && note.length > REVOCATION_NOTE_MAX_LENGTH) {
    throw new InvalidRequestError(
      `A note is at most ${REVOCATION_NOTE_MAX_LENGTH} characters`,
    );
  }
};

// The certificate as stored now.
const readStored = async (
  coreTable: CoreTable,
  certificate: Certificate,
): Promise<Certificate> => {
  const { data } = await coreTable.entities.certificate
    .get({ userId: certificate.userId, courseId: certificate.courseId })
    .go();
  return data ?? certificate;
};

// Revokes a certificate. The certificate's patch (conditioned on it not being
// revoked) and the `certificateEvent` are one transaction, so of two
// simultaneous revokes one is cancelled and returns the stored certificate,
// and only one event is written. The student is told after the transaction,
// with a dedupe key naming the event. This and restoreCertificate are the
// only writers of both records.
export const revokeCertificate = async ({
  coreTable,
  certificate,
  actor,
  reason,
  note,
  now,
}: RevokeCertificateInput): Promise<Certificate> => {
  const trimmed = note?.trim() || undefined;
  if (reason === 'refunded' && actor.role !== 'admin') {
    throw new InvalidRequestError(
      'Only an administrator can revoke a certificate for a refund',
    );
  }
  checkNote(trimmed);
  if (reason === 'other' && !trimmed) {
    throw new InvalidRequestError('Say why in a note');
  }

  const { userId, courseId } = certificate;
  const occurredAt = now.toISOString();
  const entities = transactionEntities(coreTable);
  const { canceled } = await coreTable.transaction
    .write(() => [
      entities.certificate
        .patch({ userId, courseId })
        .set({
          revokedAt: occurredAt,
          revocationReason: reason,
          revokedByRole: actor.role,
        })
        .where((attr, op) => op.notExists(attr.revokedAt))
        .commit(),
      entities.certificateEvent
        .create({
          userId,
          courseId,
          occurredAt,
          certificateId: certificate.certificateId,
          type: 'revoked',
          reason,
          ...(trimmed && { note: trimmed }),
          actorId: actor.id,
          actorRole: actor.role,
        })
        .commit(),
    ])
    .go();
  if (canceled) {
    return readStored(coreTable, certificate);
  }

  await publishNotification(coreTable, {
    type: 'certificate.revoked',
    userId,
    params: {
      courseId,
      courseTitle: certificate.courseTitle,
      reason: revocationReasonLabel(reason),
    },
    dedupeKey: `${certificate.certificateId}:${occurredAt}`,
    occurredAt,
  });
  return readStored(coreTable, certificate);
};

export interface RestoreCertificateInput {
  coreTable: CoreTable;
  certificate: Certificate;
  actor: CertificateActor;
  note?: string;
  now: Date;
}

// Makes a revoked certificate valid again: one transaction removes the three
// revocation attributes, on the condition that `revokedAt` is still what the
// caller read, and creates the event. An instructor cannot undo an
// administrator's revocation. A certificate that is not revoked is returned
// as it is. The student is told after the transaction.
export const restoreCertificate = async ({
  coreTable,
  certificate,
  actor,
  note,
  now,
}: RestoreCertificateInput): Promise<Certificate> => {
  const { revokedAt } = certificate;
  if (!revokedAt) {
    return certificate;
  }
  const trimmed = note?.trim() || undefined;
  if (actor.role === 'instructor' && certificate.revokedByRole === 'admin') {
    throw new RestoreForbiddenError();
  }
  checkNote(trimmed);

  const { userId, courseId } = certificate;
  // Never before the revocation it undoes, so the history stays in order.
  const occurredAt = new Date(
    Math.max(now.getTime(), Date.parse(revokedAt) + 1),
  ).toISOString();
  const entities = transactionEntities(coreTable);
  const { canceled } = await coreTable.transaction
    .write(() => [
      entities.certificate
        .patch({ userId, courseId })
        .remove(['revokedAt', 'revocationReason', 'revokedByRole'])
        .where((attr, op) => op.eq(attr.revokedAt, revokedAt))
        .commit(),
      entities.certificateEvent
        .create({
          userId,
          courseId,
          occurredAt,
          certificateId: certificate.certificateId,
          type: 'restored',
          ...(trimmed && { note: trimmed }),
          actorId: actor.id,
          actorRole: actor.role,
        })
        .commit(),
    ])
    .go();
  if (canceled) {
    return readStored(coreTable, certificate);
  }

  await publishNotification(coreTable, {
    type: 'certificate.restored',
    userId,
    params: { courseId, courseTitle: certificate.courseTitle },
    dedupeKey: `${certificate.certificateId}:${occurredAt}`,
    occurredAt,
  });
  return readStored(coreTable, certificate);
};
