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
  // Pass marks come with quizzes; a certificate that assessed only graded
  // uploads has a band but no pass marks.
  const hasQuiz = items.some((i) => i.kind === 'quiz');
  if (
    hasQuiz !== (passMarkLowest !== undefined) ||
    hasQuiz !== (passMarkHighest !== undefined) ||
    band === undefined
  ) {
    problems.push('assessment lacks pass marks or a band');
    return problems;
  }
  if (
    passMarkLowest !== undefined &&
    passMarkHighest !== undefined &&
    passMarkLowest > passMarkHighest
  ) {
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
    const { revokedAt, revocationReason, revokedByRole } = certificate;
    const set = [revokedAt, revocationReason, revokedByRole].filter(Boolean);
    if (set.length !== 0 && set.length !== 3) {
      problems.push(
        'revokedAt, revocationReason and revokedByRole are not all set or all absent',
      );
    }
    if (revokedAt && certificate.issuedAt && revokedAt < certificate.issuedAt) {
      problems.push('revokedAt is before issuedAt');
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

// How far a reminder's claim may be stamped after a click it still won the
// condition against. Both writes take their timestamp before they write, and
// the reminder Lambda and the API have separate clocks, so a claim that landed
// first can carry the later time by about the length of a request.
const REMINDER_CLICK_TOLERANCE_MS = 5_000;

// The reminder is never claimed after a LinkedIn use is recorded (allowing for
// the clocks, above), and never before the certificate was issued. A
// certificate with `reminderScheduledAt` and no `reminderSentAt` isn't a
// violation (not due yet, clicked, or emails off).
export const checkCertificateReminderNotAfterClick = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.certificates.flatMap((certificate) => {
    const { userId, courseId, reminderSentAt, linkedInClickedAt } = certificate;
    const problems: string[] = [];
    if (
      reminderSentAt &&
      linkedInClickedAt &&
      Date.parse(reminderSentAt) - Date.parse(linkedInClickedAt) >
        REMINDER_CLICK_TOLERANCE_MS
    ) {
      problems.push('reminderSentAt is after linkedInClickedAt');
    }
    if (
      reminderSentAt &&
      certificate.issuedAt &&
      reminderSentAt < certificate.issuedAt
    ) {
      problems.push('reminderSentAt is before issuedAt');
    }
    return problems.map((message) =>
      violation(
        'certificate-reminder-not-after-click',
        { userId, courseId },
        message,
      ),
    );
  });

// Every `certificate.issued` and `certificate.reminder` notification has a
// link of /certificates/<ID> naming a certificate of the same user, and a
// certificate has at most one of each. A reminder's certificate has
// `reminderSentAt` equal to the notification's `occurredAt`. A certificate
// with no such notification (issued before the notification existed) isn't a
// violation.
export const checkCertificateNotificationsMatch = (
  snapshot: TableSnapshot,
): Violation[] => {
  const notifications = snapshot.notifications.filter(
    (n) => n.type === 'certificate.issued' || n.type === 'certificate.reminder',
  );
  const perCertificate = new Map<string, number>();
  return notifications.flatMap((n) => {
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
        : n.type === 'certificate.reminder' &&
            certificate.reminderSentAt !== n.occurredAt
          ? `certificate ${certificateId} has reminderSentAt ${certificate.reminderSentAt}, not the notification's occurredAt`
          : undefined;
    if (problem || !certificateId) {
      return [
        violation('certificate-notifications-match', record, problem ?? ''),
      ];
    }
    const counted = `${n.type} ${certificateId}`;
    const count = (perCertificate.get(counted) ?? 0) + 1;
    perCertificate.set(counted, count);
    return count > 1
      ? [
          violation(
            'certificate-notifications-match',
            record,
            `certificate ${certificateId} has more than one ${n.type} notification`,
          ),
        ]
      : [];
  });
};

// What a certificate says was assessed was met: with a minimum upload score,
// every listed upload scored at least that and the student has a submission
// for it (it may have been reopened since); with quiz pass required, every
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
  const submitted = new Set(
    snapshot.assignmentSubmissions.map(
      (s) => `${s.userId} ${s.courseId} ${s.contentItemId}`,
    ),
  );
  return snapshot.certificates.flatMap((certificate) => {
    const { assessment, userId, courseId, issuedAt } = certificate;
    if (!assessment) {
      return [];
    }
    const items = assessment.assessedItems ?? [];
    const quizItems = items.filter((i) => i.kind === 'quiz');
    const uploadItems = items.filter((i) => i.kind === 'upload');
    const problems: string[] = [];
    if (assessment.requireQuizPass) {
      for (const item of quizItems) {
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
    } else if (quizItems.length > 0) {
      problems.push('a quiz is listed though quiz pass was not required');
    }
    const minUpload = assessment.minUploadScorePercent;
    if (minUpload === undefined) {
      if (uploadItems.length > 0) {
        problems.push('an upload is listed though no score was required');
      }
    } else {
      for (const item of uploadItems) {
        if (item.scorePercent < minUpload) {
          problems.push(
            `upload ${item.contentItemId} was listed below the required ${minUpload}%`,
          );
        }
        // A submission reopened since issue is still a submission.
        if (!submitted.has(`${userId} ${courseId} ${item.contentItemId}`)) {
          problems.push(`upload ${item.contentItemId} has no submission`);
        }
      }
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

const byTime = (a: { occurredAt: string }, b: { occurredAt: string }) =>
  a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0;

// A certificate is revoked exactly when its latest event is a revocation, with
// the same time, reason and role. Every event names an existing certificate
// of the same ID, a certificate's events alternate from a revocation, every
// event has an actor, only an administrator revokes for a refund, and the
// reason `other` has a note.
export const checkCertificateStatusMatchesHistory = (
  snapshot: TableSnapshot,
): Violation[] => {
  const certificates = new Map(
    snapshot.certificates.map((c) => [`${c.userId} ${c.courseId}`, c]),
  );
  const history = new Map<string, TableSnapshot['certificateEvents']>();
  for (const event of snapshot.certificateEvents) {
    const key = `${event.userId} ${event.courseId}`;
    history.set(key, [...(history.get(key) ?? []), event]);
  }
  const events = [...history].flatMap(([key, list]) => {
    const certificate = certificates.get(key);
    const sorted = [...list].sort(byTime);
    return sorted.flatMap((event, i) => {
      const problems: string[] = [];
      if (!certificate) {
        problems.push('event for a certificate that does not exist');
      } else if (certificate.certificateId !== event.certificateId) {
        problems.push(
          `event names certificate ${event.certificateId}, not ${certificate.certificateId}`,
        );
      }
      if (event.type !== (i % 2 === 0 ? 'revoked' : 'restored')) {
        problems.push(
          `event ${i + 1} is ${event.type}; events alternate, starting with revoked`,
        );
      }
      if (!event.actorId || !event.actorRole) {
        problems.push('event has no actor');
      }
      if (event.type === 'revoked') {
        if (!event.reason) {
          problems.push('revoked event has no reason');
        }
        if (event.reason === 'refunded' && event.actorRole !== 'admin') {
          problems.push('refunded is used by a role other than admin');
        }
        if (event.reason === 'other' && !event.note) {
          problems.push('reason other has no note');
        }
      }
      return problems.map((message) =>
        violation(
          'certificate-status-matches-history',
          {
            userId: event.userId,
            courseId: event.courseId,
            occurredAt: event.occurredAt,
          },
          message,
        ),
      );
    });
  });
  const statuses = snapshot.certificates.flatMap((certificate) => {
    const { userId, courseId } = certificate;
    const list = [...(history.get(`${userId} ${courseId}`) ?? [])].sort(byTime);
    const latest = list.at(-1);
    const problems: string[] = [];
    if (latest?.type === 'revoked') {
      if (
        certificate.revokedAt !== latest.occurredAt ||
        certificate.revocationReason !== latest.reason ||
        certificate.revokedByRole !== latest.actorRole
      ) {
        problems.push(
          'revoked, but its time, reason or role differs from the latest event',
        );
      }
    } else if (certificate.revokedAt) {
      problems.push(
        latest
          ? 'revoked, but its latest event is a restoration'
          : 'revoked, but it has no events',
      );
    }
    return problems.map((message) =>
      violation(
        'certificate-status-matches-history',
        { userId, courseId },
        message,
      ),
    );
  });
  return [...events, ...statuses];
};

export const CERTIFICATES_CHECKS = [
  { name: 'certificate-shape', check: checkCertificateShape },
  {
    name: 'certificate-status-matches-history',
    check: checkCertificateStatusMatchesHistory,
  },
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
    name: 'certificate-reminder-not-after-click',
    check: checkCertificateReminderNotAfterClick,
  },
  {
    name: 'certificate-notifications-match',
    check: checkCertificateNotificationsMatch,
  },
] as const satisfies readonly Check[];
