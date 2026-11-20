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
import { isConditionalCheckFailed } from './errors.js';

// Crockford's base32: no I, L, O or U, so an ID read aloud or copied by hand
// can't be mistaken.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_LENGTH = 16;
const MAX_ID_TRIES = 5;
export const LINKEDIN_CLICK_SOURCES = [
  'my-learning',
  'certificate-page',
  'issued-email',
  'reminder-email',
] as const;
export type LinkedInClickSource = (typeof LINKEDIN_CLICK_SOURCES)[number];

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
  coreTable: Pick<CoreTable, 'entities'>;
  enrolment: Pick<
    Item<typeof createEnrolmentEntity>,
    'userId' | 'courseId' | 'status' | 'completedAt'
  >;
  course: Pick<
    Item<typeof createCourseEntity>,
    'courseId' | 'title' | 'certificatesEnabled'
  >;
  user: Pick<Item<typeof createUserEntity>, 'givenName' | 'familyName'> | null;
  now: Date;
}

// The only writer of `certificate`. Issues the student's certificate for a
// course once they've completed it, and returns it; returns the one already
// issued if there is one, so it's safe to call again (a retried stream batch)
// or at the same time as another caller: the create is conditioned on the key
// not existing, and the loser reads the winner's record.
export const issueCertificate = async ({
  coreTable,
  enrolment,
  course,
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

  try {
    const { data } = await certificate
      .create({
        ...key,
        certificateId,
        learnerName: learnerName(user),
        courseTitle: course.title,
        completedAt,
        issuedAt: now.toISOString(),
      })
      .go();
    return data;
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    const { data: winner } = await certificate.get(key).go();
    if (!winner) {
      throw error;
    }
    return winner;
  }
};

export interface RecordLinkedInClickInput {
  coreTable: Pick<CoreTable, 'entities'>;
  certificateId: string;
  source: LinkedInClickSource;
  now: Date;
}

// Records the first use of "Add to LinkedIn profile" on a certificate. Later
// calls, or one at the same moment as another, change nothing. Undefined for a
// malformed or unknown ID.
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
  if (!found) {
    return undefined;
  }
  try {
    await certificate
      .patch({ userId: found.userId, courseId: found.courseId })
      .set({
        linkedInClickedAt: now.toISOString(),
        linkedInClickSource: source,
      })
      .where((attr, op) => op.notExists(attr.linkedInClickedAt))
      .go();
    return 'recorded';
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      throw error;
    }
    return 'already-recorded';
  }
};
