/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LINKEDIN_CLICK_SOURCES,
  normaliseCertificateId,
} from '../certificate.js';
import { scoreBand } from '../certificate-criteria.js';
import { type Check, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

type Assessment = TableSnapshot['certificates'][number]['assessment'];

const assessmentProblems = (assessment: Assessment | undefined): string[] => {
  if (!assessment) {
    return ['assessment is missing'];
  }
  const problems: string[] = [];
  const items = assessment.assessedItems ?? [];
  if (!(assessment.criteriaVersion >= 1)) {
    problems.push('assessment.criteriaVersion is below 1');
  }
  if (!(assessment.itemCount >= 1)) {
    problems.push('assessment.itemCount is below 1');
  }
  if (assessment.assessedItemCount !== items.length) {
    problems.push('assessment.assessedItemCount is not the list length');
  }
  const { passMarkLowest, passMarkHighest, scoreBand: band } = assessment;
  if (items.length === 0) {
    if (
      passMarkLowest !== undefined ||
      passMarkHighest !== undefined ||
      band !== undefined
    ) {
      problems.push(
        'assessment has pass marks or a band with nothing assessed',
      );
    }
    return problems;
  }
  if (
    passMarkLowest === undefined ||
    passMarkHighest === undefined ||
    band === undefined
  ) {
    problems.push('assessment lacks pass marks or a band');
    return problems;
  }
  if (passMarkLowest > passMarkHighest) {
    problems.push('assessment.passMarkLowest is above passMarkHighest');
  }
  if (!Number.isInteger(band) || band < 0 || band > 90 || band % 10 !== 0) {
    problems.push(`assessment.scoreBand ${band} is not 0, 10 ... 90`);
  } else {
    const mean =
      items.reduce((sum, i) => sum + i.scorePercent, 0) / items.length;
    if (band !== scoreBand(mean)) {
      problems.push('assessment.scoreBand is not the band of the mean score');
    }
  }
  return problems;
};

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
    problems.push(...assessmentProblems(certificate.assessment));
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

// Every `certificate.issued` notification has a link of /certificates/<ID>
// naming a certificate of the same user, and a certificate has at most one.
// A certificate with no such notification (issued before the notification
// existed) isn't a violation.
export const checkCertificateNotificationsMatch = (
  snapshot: TableSnapshot,
): Violation[] => {
  const issued = snapshot.notifications.filter(
    (n) => n.type === 'certificate.issued',
  );
  const perCertificate = new Map<string, number>();
  return issued.flatMap((n) => {
    const record = { userId: n.userId, occurredAt: n.occurredAt, id: n.id };
    const named = /^\/certificates\/([^/?#]+)$/.exec(n.link?.path ?? '')?.[1];
    const certificateId = named ? normaliseCertificateId(named) : undefined;
    const certificate = certificateId
      ? snapshot.certificates.find((c) => c.certificateId === certificateId)
      : undefined;
    const problem = !certificate
      ? `link ${n.link?.path} does not name a certificate`
      : certificate.userId !== n.userId
        ? `link ${n.link?.path} names another user's certificate`
        : undefined;
    if (problem || !certificateId) {
      return [
        violation('certificate-notifications-match', record, problem ?? ''),
      ];
    }
    const count = (perCertificate.get(certificateId) ?? 0) + 1;
    perCertificate.set(certificateId, count);
    return count > 1
      ? [
          violation(
            'certificate-notifications-match',
            record,
            `certificate ${certificateId} has more than one certificate.issued notification`,
          ),
        ]
      : [];
  });
};

// What a certificate says was assessed was met: with quiz pass required, every
// listed quiz has a score at or above its pass mark (above 0) that the
// student's quizSummary backs, passed by the time of issue; with nothing
// required, the list is empty. Compared with what the certificate recorded,
// not the course's current criteria or quizzes, which may have changed since.
export const checkCertificateMetCriteria = (
  snapshot: TableSnapshot,
): Violation[] => {
  const summaries = new Map(
    snapshot.quizSummaries.map((q) => [
      `${q.userId} ${q.courseId} ${q.contentItemId}`,
      q,
    ]),
  );
  return snapshot.certificates.flatMap((certificate) => {
    const { assessment, userId, courseId, issuedAt } = certificate;
    if (!assessment) {
      return [];
    }
    const items = assessment.assessedItems ?? [];
    const problems: string[] = [];
    if (assessment.requireQuizPass) {
      for (const item of items) {
        const summary = summaries.get(
          `${userId} ${courseId} ${item.contentItemId}`,
        );
        const mark = item.passMarkPercent ?? 0;
        if (!(mark > 0 && item.scorePercent >= mark)) {
          problems.push(
            `quiz ${item.contentItemId} was listed below its pass mark`,
          );
        }
        if (
          !summary?.passedAt ||
          summary.passedAt > issuedAt ||
          summary.bestScore < item.scorePercent
        ) {
          problems.push(
            `quiz ${item.contentItemId} has no passing quizSummary before issue`,
          );
        }
      }
    } else if (
      assessment.minUploadScorePercent === undefined &&
      items.length > 0
    ) {
      problems.push('assessedItems is not empty though nothing was required');
    }
    return problems.map((message) =>
      violation('certificate-met-criteria', { userId, courseId }, message),
    );
  });
};

// Every course has certificate criteria: an integer version from 1 and, when
// present, an upload score threshold of 1 to 100.
export const checkCourseCertificateCriteriaShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.courses.flatMap(({ courseId, certificateCriteria: criteria }) => {
    const problems: string[] = [];
    if (!criteria) {
      problems.push('certificateCriteria is missing');
    } else {
      if (!Number.isInteger(criteria.version) || criteria.version < 1) {
        problems.push('certificateCriteria.version is not an integer from 1');
      }
      const min = criteria.minUploadScorePercent;
      if (min !== undefined && !(min >= 1 && min <= 100)) {
        problems.push(
          'certificateCriteria.minUploadScorePercent is not 1 to 100',
        );
      }
    }
    return problems.map((message) =>
      violation('course-certificate-criteria-shape', { courseId }, message),
    );
  });

export const CERTIFICATES_CHECKS = [
  { name: 'certificate-shape', check: checkCertificateShape },
  { name: 'certificate-met-criteria', check: checkCertificateMetCriteria },
  {
    name: 'course-certificate-criteria-shape',
    check: checkCourseCertificateCriteriaShape,
  },
  {
    name: 'certificate-has-completed-enrolment',
    check: checkCertificateHasCompletedEnrolment,
  },
  {
    name: 'certificate-linkedin-click-shape',
    check: checkCertificateLinkedInClickShape,
  },
  {
    name: 'certificate-notifications-match',
    check: checkCertificateNotificationsMatch,
  },
] as const satisfies readonly Check[];
