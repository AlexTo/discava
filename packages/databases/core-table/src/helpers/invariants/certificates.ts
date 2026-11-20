/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LINKEDIN_CLICK_SOURCES } from '../certificate.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// A certificate's ID is 16 characters of the Crockford
// alphabet and unique across certificates, it carries the name, title and
// dates printed on it, and it wasn't issued before the course was completed.
export const checkCertificateShape = (snapshot: TableSnapshot): Violation[] => {
  const idCounts = new Map<string, number>();
  for (const { certificateId } of snapshot.certificates) {
    idCounts.set(certificateId, (idCounts.get(certificateId) ?? 0) + 1);
  }
  return snapshot.certificates.flatMap((certificate) => {
    const { userId, courseId, certificateId } = certificate;
    const record = { userId, courseId };
    const problems: string[] = [];
    if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(certificateId ?? '')) {
      problems.push(
        `ID ${certificateId} is not 16 Crockford base32 characters`,
      );
    }
    if ((idCounts.get(certificateId) ?? 0) > 1) {
      problems.push(`ID ${certificateId} is on more than one certificate`);
    }
    for (const field of [
      'learnerName',
      'courseTitle',
      'completedAt',
      'issuedAt',
    ] as const) {
      if (!certificate[field]) {
        problems.push(`${field} is missing`);
      }
    }
    if (
      certificate.issuedAt &&
      certificate.completedAt &&
      certificate.issuedAt < certificate.completedAt
    ) {
      problems.push('issuedAt is before completedAt');
    }
    return problems.map((message) =>
      violation('certificate-shape', record, message),
    );
  });
};

// A certificate is for a completed enrolment, with the same completedAt, in a
// course that exists. A refunded student keeps their certificate, so the
// enrolment may also be `dropped` with that completedAt. Certificates off for
// the course is not a violation (the setting isn't retroactive), nor is a completed
// enrolment without a certificate (no backfill).
export const checkCertificateHasCompletedEnrolment = (
  snapshot: TableSnapshot,
): Violation[] => {
  const enrolments = new Map(
    snapshot.enrolments.map((e) => [`${e.userId} ${e.courseId}`, e]),
  );
  const courses = new Set(snapshot.courses.map((c) => c.courseId));
  return snapshot.certificates.flatMap(({ userId, courseId, completedAt }) => {
    const record = { userId, courseId };
    const enrolment = enrolments.get(`${userId} ${courseId}`);
    const problems: string[] = [];
    if (!enrolment) {
      problems.push('certificate for a student not enrolled in the course');
    } else if (
      enrolment.status !== 'completed' &&
      !(enrolment.status === 'dropped' && enrolment.completedAt)
    ) {
      problems.push(`enrolment is ${enrolment.status}, not completed`);
    } else if (enrolment.completedAt !== completedAt) {
      problems.push("completedAt differs from the enrolment's");
    }
    if (!courses.has(courseId)) {
      problems.push('certificate for a course that does not exist');
    }
    return problems.map((message) =>
      violation('certificate-has-completed-enrolment', record, message),
    );
  });
};

// A certificate's LinkedIn use has a source exactly when it has a time, the
// source is one of the known ones, and the time isn't before issuedAt.
export const checkCertificateLinkedInClickShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.certificates.flatMap((certificate) => {
    const { userId, courseId, linkedInClickedAt, linkedInClickSource } =
      certificate;
    const problems: string[] = [];
    if (Boolean(linkedInClickedAt) !== Boolean(linkedInClickSource)) {
      problems.push(
        'linkedInClickSource is present exactly when linkedInClickedAt is',
      );
    }
    if (
      linkedInClickSource &&
      !(LINKEDIN_CLICK_SOURCES as readonly string[]).includes(
        linkedInClickSource,
      )
    ) {
      problems.push(`linkedInClickSource ${linkedInClickSource} is unknown`);
    }
    if (
      linkedInClickedAt &&
      certificate.issuedAt &&
      linkedInClickedAt < certificate.issuedAt
    ) {
      problems.push('linkedInClickedAt is before issuedAt');
    }
    return problems.map((message) =>
      violation(
        'certificate-linkedin-click-shape',
        { userId, courseId },
        message,
      ),
    );
  });

export const CERTIFICATES_CHECKS = [
  { name: 'certificate-shape', check: checkCertificateShape },
  {
    name: 'certificate-has-completed-enrolment',
    check: checkCertificateHasCompletedEnrolment,
  },
  {
    name: 'certificate-linkedin-click-shape',
    check: checkCertificateLinkedInClickShape,
  },
] as const satisfies readonly Check[];
