/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { EntityItem } from 'electrodb';
import type { createAssignmentSubmissionEntity } from '../entities/assignment-submission.js';
import type { createCertificateEntity } from '../entities/certificate.js';
import type { createContentItemEntity } from '../entities/content-item.js';
import type { createCourseEntity } from '../entities/course.js';
import type { createCourseInstructorEntity } from '../entities/course-instructor.js';
import type { createCourseStatsEntity } from '../entities/course-stats.js';
import type { createEnrolmentEntity } from '../entities/enrolment.js';
import type { createItemCompletionEntity } from '../entities/item-completion.js';
import type { createLessonEntity } from '../entities/lesson.js';
import type { createLessonStatsEntity } from '../entities/lesson-stats.js';
import type { createModuleEntity } from '../entities/module.js';
import type { createNotificationEntity } from '../entities/notification.js';
import type { createNotificationBroadcastEntity } from '../entities/notification-broadcast.js';
import type { createNotificationPreferenceEntity } from '../entities/notification-preference.js';
import type { createNotificationStateEntity } from '../entities/notification-state.js';
import type { createPeriodStatsEntity } from '../entities/period-stats.js';
import type { createProgressEntity } from '../entities/progress.js';
import type { createQuizAttemptEntity } from '../entities/quiz-attempt.js';
import type { createQuizQuestionStatsEntity } from '../entities/quiz-question-stats.js';
import type { createQuizScoreStatsEntity } from '../entities/quiz-score-stats.js';
import type { createQuizSummaryEntity } from '../entities/quiz-summary.js';
import type { createUserEntity } from '../entities/user.js';
import type { createVideoPositionEntity } from '../entities/video-position.js';
import type { createCoreTableService } from '../service.js';
import {
  aggregatesOf,
  contributions,
  funnelContributions,
  sumContributions,
} from './analytics.js';
import { MAX_CAPTION_TRACKS } from './caption-tracks.js';
import { parseNotificationPosition } from './notification.js';
import { NOTIFICATION_TYPES } from './notification-types.js';
import { computeProgress } from './progress.js';
import { isValidPosition } from './video-position.js';

// Rules the core table must keep that span several records, or several
// writers (core-api, instructor-api, the event handlers), and that no schema
// enforces (#57). Each check reads a snapshot of the table and returns every
// record that breaks its rule; nothing here writes.

type Item<F extends () => Promise<any>> = EntityItem<Awaited<ReturnType<F>>>;

// The records the checks read, holding only the attributes they use, so
// tests can build them by hand.
export interface TableSnapshot {
  courses: Pick<
    Item<typeof createCourseEntity>,
    'courseId' | 'status' | 'publishedAt' | 'updatedAt' | 'lastChildOrder'
  >[];
  modules: Pick<
    Item<typeof createModuleEntity>,
    | 'courseId'
    | 'moduleId'
    | 'order'
    | 'visibility'
    | 'archivedAt'
    | 'publishedAt'
    | 'lastChildOrder'
  >[];
  lessons: Pick<
    Item<typeof createLessonEntity>,
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'kind'
    | 'order'
    | 'visibility'
    | 'archivedAt'
    | 'publishedAt'
    | 'lastChildOrder'
  >[];
  contentItems: Pick<
    Item<typeof createContentItemEntity>,
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'type'
    | 'status'
    | 'order'
    | 'visibility'
    | 'archivedAt'
    | 'publishedAt'
    | 'studentActivityCount'
    | 's3Key'
    | 'previousS3Key'
    | 'transcodePending'
    | 'transcodePendingSince'
    | 'submissionNonce'
    | 'captionTracks'
    | 'captionTracksRev'
    | 'captionsStatus'
    | 'captionsPendingSince'
    | 'fileName'
    | 'fileSize'
    | 'mimeType'
  >[];
  courseInstructors: Pick<
    Item<typeof createCourseInstructorEntity>,
    'courseId' | 'instructorId' | 'courseUpdatedAt'
  >[];
  enrolments: Pick<
    Item<typeof createEnrolmentEntity>,
    | 'courseId'
    | 'userId'
    | 'status'
    | 'progressPercent'
    | 'completedAt'
    | 'lastActivityAt'
    | 'createdAt'
  >[];
  itemCompletions: Pick<
    Item<typeof createItemCompletionEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'completedAt'
  >[];
  progress: Pick<
    Item<typeof createProgressEntity>,
    'userId' | 'courseId' | 'lessonId' | 'status' | 'completedAt'
  >[];
  quizAttempts: Pick<
    Item<typeof createQuizAttemptEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'attemptId'
    | 'scorePercent'
    | 'passed'
    | 'submittedAt'
  >[];
  quizSummaries: Pick<
    Item<typeof createQuizSummaryEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'attemptsUsed'
    | 'bestScore'
    | 'bestAttemptId'
    | 'passedAt'
  >[];
  assignmentSubmissions: Pick<
    Item<typeof createAssignmentSubmissionEntity>,
    | 'userId'
    | 'courseId'
    | 'moduleId'
    | 'lessonId'
    | 'contentItemId'
    | 'file'
    | 'version'
    | 'submittedAt'
  >[];
  certificates: Pick<
    Item<typeof createCertificateEntity>,
    | 'userId'
    | 'courseId'
    | 'certificateId'
    | 'learnerName'
    | 'courseTitle'
    | 'completedAt'
    | 'issuedAt'
  >[];
  videoPositions: Pick<
    Item<typeof createVideoPositionEntity>,
    | 'userId'
    | 'courseId'
    | 'lessonId'
    | 'contentItemId'
    | 'positionSeconds'
    | 'versionId'
  >[];
  users: Pick<Item<typeof createUserEntity>, 'userId'>[];
  // The analytics aggregates (not their markers, which only guard against
  // double counting).
  courseStats: Pick<
    Item<typeof createCourseStatsEntity>,
    'courseId' | 'enrolments' | 'completed' | 'dropped'
  >[];
  periodStats: Pick<
    Item<typeof createPeriodStatsEntity>,
    'courseId' | 'periodKey' | 'enrolments' | 'activeLearners'
  >[];
  lessonStats: Pick<
    Item<typeof createLessonStatsEntity>,
    'courseId' | 'lessonId' | 'inProgress' | 'completed'
  >[];
  quizQuestionStats: Pick<
    Item<typeof createQuizQuestionStatsEntity>,
    'courseId' | 'contentItemId' | 'questionId' | 'attempts' | 'misses'
  >[];
  quizScoreStats: Pick<
    Item<typeof createQuizScoreStatsEntity>,
    'courseId' | 'contentItemId'
  >[];
  notifications: Pick<
    Item<typeof createNotificationEntity>,
    | 'userId'
    | 'occurredAt'
    | 'id'
    | 'type'
    | 'link'
    | 'readAt'
    | 'email'
    | 'createdAt'
  >[];
  notificationStates: Pick<
    Item<typeof createNotificationStateEntity>,
    'userId' | 'unreadCount' | 'readThrough'
  >[];
  notificationPreferences: Pick<
    Item<typeof createNotificationPreferenceEntity>,
    'userId' | 'type'
  >[];
  notificationBroadcasts: Pick<
    Item<typeof createNotificationBroadcastEntity>,
    'id' | 'type' | 'courseId' | 'status' | 'completedAt' | 'createdAt'
  >[];
}

export const INVARIANTS = [
  'course-has-instructor',
  'activity-count-matches-students',
  'quiz-summary-matches-attempts',
  'progress-matches-completions',
  'instructor-course-updated-at',
  'video-transcode-state',
  'file-item-shape',
  'published-at-set',
  'completed-at-iff-completed',
  'curriculum-has-parents',
  'student-records-have-targets',
  'instructor-has-user',
  'student-records-enrolled',
  'enrolment-in-published-course',
  'sibling-order-unique',
  'student-records-placed-with-item',
  'last-activity-at-current',
  'draft-course-nothing-archived',
  'child-order-claimed',
  'assignment-lesson-shape',
  'assignment-submission-shape',
  'certificate-shape',
  'certificate-has-completed-enrolment',
  'video-position-valid',
  'caption-tracks-valid',
  'analytics-matches-records',
  'notification-unread-count-matches',
  'notification-shape',
  'notification-state-exists',
  'notification-preference-shape',
  'notification-broadcast-done-complete',
] as const;

export type InvariantName = (typeof INVARIANTS)[number];

export interface InvariantViolation {
  invariant: InvariantName;
  message: string;
  // The record's key, enough to find it in the table.
  record: Record<string, string>;
}

// A stable identity for a violation, to compare two checks of the same
// table (e.g. before and after an e2e scenario).
export const violationId = ({ invariant, record }: InvariantViolation) =>
  `${invariant} ${JSON.stringify(record)}`;

const violation = (
  invariant: InvariantName,
  record: Record<string, string>,
  message: string,
): InvariantViolation => ({ invariant, record, message });

// Every record a student's work in a course leaves, with its key: their
// completions, quiz attempts, quiz summaries and assignment submissions.
const studentRecords = (snapshot: TableSnapshot) => [
  ...snapshot.itemCompletions.map((r) => ({
    ...r,
    kind: 'completion',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
    },
  })),
  ...snapshot.quizAttempts.map((r) => ({
    ...r,
    kind: 'quiz attempt',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
      attemptId: r.attemptId,
    },
  })),
  ...snapshot.quizSummaries.map((r) => ({
    ...r,
    kind: 'quiz summary',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
    },
  })),
  ...snapshot.assignmentSubmissions.map((r) => ({
    ...r,
    kind: 'submission',
    key: {
      userId: r.userId,
      courseId: r.courseId,
      contentItemId: r.contentItemId,
    },
  })),
];

const groupBy = <T, K>(items: T[], key: (item: T) => K) => {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return groups;
};

// 1. Every course has at least one instructor. Kept by course.create's
// transaction; nothing removes an instructor yet.
export const checkCourseHasInstructor = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const taught = new Set(snapshot.courseInstructors.map((c) => c.courseId));
  return snapshot.courses
    .filter(({ courseId }) => !taught.has(courseId))
    .map(({ courseId }) =>
      violation('course-has-instructor', { courseId }, 'has no instructor'),
    );
};

// 2. A content item's studentActivityCount is the number of distinct
// students with records for it: an itemCompletion, an assignmentSubmission,
// or for a quiz a quizSummary. Each is created in the transaction that increments the count,
// and neither is ever removed, so the count is exact. It gates permanent
// deletion, so too low a count could let student data be destroyed.
export const checkActivityCountMatchesStudents = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const students = new Map<string, Set<string>>();
  for (const { contentItemId, userId } of [
    ...snapshot.itemCompletions,
    ...snapshot.quizSummaries,
    ...snapshot.assignmentSubmissions,
  ]) {
    students.set(
      contentItemId,
      (students.get(contentItemId) ?? new Set()).add(userId),
    );
  }
  return snapshot.contentItems.flatMap(
    ({ courseId, contentItemId, studentActivityCount }) => {
      const expected = students.get(contentItemId)?.size ?? 0;
      return studentActivityCount === expected
        ? []
        : [
            violation(
              'activity-count-matches-students',
              { courseId, contentItemId },
              `studentActivityCount is ${studentActivityCount}, but ${expected} students have records for it`,
            ),
          ];
    },
  );
};

// 3. A quizSummary agrees with its student's attempts at that quiz: the
// number used, the best score and which attempt got it, and passedAt set
// exactly when an attempt passed. quiz.submitAttempt writes both in one
// transaction. (Whether attemptsUsed stayed within the attempt limit can't be
// checked afterwards: the limit may have changed since.)
export const checkQuizSummaryMatchesAttempts = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const key = (r: { userId: string; contentItemId: string }) =>
    `${r.userId} ${r.contentItemId}`;
  const attempts = groupBy(snapshot.quizAttempts, key);
  const summarized = new Set(snapshot.quizSummaries.map(key));

  const summaryViolations = snapshot.quizSummaries.flatMap((summary) => {
    const record = {
      userId: summary.userId,
      courseId: summary.courseId,
      contentItemId: summary.contentItemId,
    };
    const own = attempts.get(key(summary)) ?? [];
    const problems: string[] = [];
    if (summary.attemptsUsed !== own.length) {
      problems.push(
        `attemptsUsed is ${summary.attemptsUsed}, but there are ${own.length} attempts`,
      );
    }
    const best = Math.max(...own.map((a) => a.scorePercent));
    if (own.length > 0 && summary.bestScore !== best) {
      problems.push(
        `bestScore is ${summary.bestScore}, but the best attempt scored ${best}`,
      );
    }
    const bestAttempt = own.find((a) => a.attemptId === summary.bestAttemptId);
    if (!bestAttempt || bestAttempt.scorePercent !== summary.bestScore) {
      problems.push(
        `bestAttemptId ${summary.bestAttemptId} isn't an attempt scoring bestScore`,
      );
    }
    const passed = own.some((a) => a.passed);
    if (passed !== (summary.passedAt !== undefined)) {
      problems.push(
        passed
          ? 'an attempt passed, but passedAt is not set'
          : 'passedAt is set, but no attempt passed',
      );
    }
    return problems.map((message) =>
      violation('quiz-summary-matches-attempts', record, message),
    );
  });

  const orphanAttempts = snapshot.quizAttempts
    .filter((attempt) => !summarized.has(key(attempt)))
    .map(({ userId, courseId, contentItemId, attemptId }) =>
      violation(
        'quiz-summary-matches-attempts',
        { userId, courseId, contentItemId, attemptId },
        'attempt has no quizSummary',
      ),
    );

  return [...summaryViolations, ...orphanAttempts];
};

// 4. Each enrolled student's progress is what the progress recalculation
// computes from their completions and the course's effectively visible
// curriculum. Completion is permanent, so a lesson or enrolment already
// completed stays so even once new content makes it incomplete; anything not
// yet completed must match. The recalculation runs from the table's stream,
// so this only holds once it has caught up. An enrolment in a course that
// doesn't exist is left to checkStudentRecordsHaveTargets.
export const checkProgressMatchesCompletions = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const courses = new Set(snapshot.courses.map(({ courseId }) => courseId));
  const byCourse = <T extends { courseId: string }>(items: T[]) =>
    groupBy(items, ({ courseId }) => courseId);
  const modules = byCourse(snapshot.modules);
  const lessons = byCourse(snapshot.lessons);
  const contentItems = byCourse(snapshot.contentItems);
  const completions = groupBy(
    snapshot.itemCompletions,
    ({ userId, courseId }) => `${userId} ${courseId}`,
  );
  const progress = groupBy(
    snapshot.progress,
    ({ userId, courseId }) => `${userId} ${courseId}`,
  );

  return snapshot.enrolments
    .filter(
      ({ courseId, status }) => status !== 'dropped' && courses.has(courseId),
    )
    .flatMap((enrolment) => {
      const { courseId, userId } = enrolment;
      const studentCourse = `${userId} ${courseId}`;
      const expected = computeProgress(
        {
          modules: modules.get(courseId) ?? [],
          lessons: lessons.get(courseId) ?? [],
          contentItems: contentItems.get(courseId) ?? [],
        },
        new Set(
          (completions.get(studentCourse) ?? []).map((c) => c.contentItemId),
        ),
      );
      const stored = new Map(
        (progress.get(studentCourse) ?? []).map((p) => [p.lessonId, p.status]),
      );

      const lessonViolations = expected.lessons.flatMap(
        ({ lessonId, status }) => {
          const current = stored.get(lessonId) ?? 'not_started';
          return current === 'completed' || current === status
            ? []
            : [
                violation(
                  'progress-matches-completions',
                  { userId, courseId, lessonId },
                  `lesson progress is ${current}, but should be ${status}`,
                ),
              ];
        },
      );

      const record = { userId, courseId };
      const enrolmentViolations: InvariantViolation[] = [];
      if ((enrolment.progressPercent ?? 0) !== expected.progressPercent) {
        enrolmentViolations.push(
          violation(
            'progress-matches-completions',
            record,
            `progressPercent is ${enrolment.progressPercent ?? 0}, but should be ${expected.progressPercent}`,
          ),
        );
      }
      if (expected.completed && enrolment.status !== 'completed') {
        enrolmentViolations.push(
          violation(
            'progress-matches-completions',
            record,
            `every item is completed, but the enrolment is ${enrolment.status}`,
          ),
        );
      }
      return [...lessonViolations, ...enrolmentViolations];
    });
};

// 5. Each courseInstructor's courseUpdatedAt is its course's updatedAt: it
// orders an instructor's course list, and every procedure that writes a
// course copies it to the course's instructors.
export const checkInstructorCourseUpdatedAt = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const updatedAt = new Map(
    snapshot.courses.map(({ courseId, updatedAt }) => [courseId, updatedAt]),
  );
  return snapshot.courseInstructors.flatMap(
    ({ courseId, instructorId, courseUpdatedAt }) => {
      const expected = updatedAt.get(courseId);
      return expected === undefined || expected === courseUpdatedAt
        ? []
        : [
            violation(
              'instructor-course-updated-at',
              { courseId, instructorId },
              `courseUpdatedAt is ${courseUpdatedAt}, but the course's updatedAt is ${expected}`,
            ),
          ];
    },
  );
};

// 6. A video's transcode state is consistent: transcodePending and
// transcodePendingSince are set together, and only while it's pending (they
// put it in byTranscodePending); a ready video plays from a master.m3u8.
// Caption attributes appear only on video items, and
// captionsStatus: pending only with captionsPendingSince and only on a ready
// video.
export const checkVideoTranscodeState = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.contentItems.flatMap((item) => {
    const record = {
      courseId: item.courseId,
      contentItemId: item.contentItemId,
    };
    const problems: string[] = [];
    const pending = item.transcodePending !== undefined;
    if (pending !== (item.transcodePendingSince !== undefined)) {
      problems.push(
        'transcodePending and transcodePendingSince are not set together',
      );
    }
    if (pending && (item.type !== 'video' || item.status !== 'pending')) {
      problems.push(
        `transcodePending is set on a ${item.status} ${item.type} item`,
      );
    }
    if (
      item.type === 'video' &&
      item.status === 'ready' &&
      !item.s3Key?.endsWith('/master.m3u8')
    ) {
      problems.push(`a ready video's s3Key is ${item.s3Key ?? 'not set'}`);
    }
    if (
      item.type !== 'video' &&
      (item.captionTracks !== undefined ||
        item.captionTracksRev !== undefined ||
        item.captionsStatus !== undefined ||
        item.captionsPendingSince !== undefined)
    ) {
      problems.push(`caption attributes are set on a ${item.type} item`);
    }
    if (item.captionsStatus === 'pending') {
      if (item.captionsPendingSince === undefined) {
        problems.push('captionsStatus is pending without captionsPendingSince');
      }
      if (item.type === 'video' && item.status !== 'ready') {
        problems.push(`captionsStatus is pending on a ${item.status} video`);
      }
    } else if (item.captionsPendingSince !== undefined) {
      problems.push(
        'captionsPendingSince is set while captions are not pending',
      );
    }
    return problems.map((message) =>
      violation('video-transcode-state', record, message),
    );
  });

// 24 (captions). A video's caption tracks are valid: at most 10, one per
// language, exactly one default when there are any, each of the item's
// played version (the version swap drops every other nonce in the same patch
// that sets status: ready), and each file under that version's captions
// folder.
export const checkCaptionTracksValid = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.contentItems.flatMap((item) => {
    const tracks = item.captionTracks ?? [];
    if (tracks.length === 0) {
      return [];
    }
    const record = {
      courseId: item.courseId,
      contentItemId: item.contentItemId,
    };
    // The version students play: the ready video's own manifest, else the
    // previous one kept while a replacement transcodes (or after it failed),
    // whose tracks stay with it until the swap.
    const manifest = item.status === 'ready' ? item.s3Key : item.previousS3Key;
    // The nonce the manifest lives under (as server-utils' manifestNonce).
    const nonce = manifest?.match(
      /\/content-items\/[^/]+\/([^/]+)\/[^/]+$/,
    )?.[1];
    // The item's folder: everything before the version's nonce.
    const folder =
      manifest && nonce
        ? manifest.slice(0, manifest.length - `/${nonce}/master.m3u8`.length)
        : undefined;
    const problems: string[] = [];
    if (tracks.length > MAX_CAPTION_TRACKS) {
      problems.push(
        `${tracks.length} caption tracks, at most ${MAX_CAPTION_TRACKS}`,
      );
    }
    const languages = new Set<string>();
    for (const track of tracks) {
      if (languages.has(track.language)) {
        problems.push(`two caption tracks in ${track.language}`);
      }
      languages.add(track.language);
      if (track.nonce !== nonce) {
        problems.push(
          `track ${track.trackId} is for version ${track.nonce}, not the current ${nonce}`,
        );
      }
      if (
        !folder ||
        !track.key.startsWith(`${folder}/${track.nonce}/captions/`)
      ) {
        problems.push(
          `track ${track.trackId} key ${track.key} is outside the version's captions folder`,
        );
      }
    }
    const defaults = tracks.filter((track) => track.isDefault).length;
    if (defaults !== 1) {
      problems.push(`${defaults} default caption tracks, expected 1`);
    }
    return problems.map((message) =>
      violation('caption-tracks-valid', record, message),
    );
  });

// 6 (files, #102). A file item has its file: the key, name, size and type,
// with the key in the version folder its submissionNonce names, which is what
// replacing or deleting it retires.
export const checkFileItemShape = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.contentItems
    .filter(({ type }) => type === 'file')
    .flatMap((item) => {
      const record = {
        courseId: item.courseId,
        contentItemId: item.contentItemId,
      };
      const missing = (
        [
          's3Key',
          'fileName',
          'fileSize',
          'mimeType',
          'submissionNonce',
        ] as const
      ).filter((attribute) => item[attribute] === undefined);
      if (missing.length > 0) {
        return [
          violation('file-item-shape', record, `missing ${missing.join(', ')}`),
        ];
      }
      return item.s3Key?.includes(
        `/content-items/${item.contentItemId}/${item.submissionNonce}/`,
      )
        ? []
        : [
            violation(
              'file-item-shape',
              record,
              `s3Key ${item.s3Key} isn't in the item's ${item.submissionNonce} folder`,
            ),
          ];
    });

// 7. publishedAt records the first time something was open to students: a
// published course has one and a draft course doesn't (publishing sets it,
// and restoring an archived course sends it back to draft only without one);
// a visible module, lesson or content item has one, since every write that
// makes a record visible sets it if it isn't already.
export const checkPublishedAtSet = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const courseViolations = snapshot.courses.flatMap(
    ({ courseId, status, publishedAt }) =>
      status === 'published' && !publishedAt
        ? [
            violation(
              'published-at-set',
              { courseId },
              'published, but publishedAt is not set',
            ),
          ]
        : status === 'draft' && publishedAt
          ? [
              violation(
                'published-at-set',
                { courseId },
                'a draft, but publishedAt is set',
              ),
            ]
          : [],
  );
  const curriculum = [
    ...snapshot.modules.map((r) => ({
      record: { courseId: r.courseId, moduleId: r.moduleId },
      ...r,
    })),
    ...snapshot.lessons.map((r) => ({
      record: { courseId: r.courseId, lessonId: r.lessonId },
      ...r,
    })),
    ...snapshot.contentItems.map((r) => ({
      record: { courseId: r.courseId, contentItemId: r.contentItemId },
      ...r,
    })),
  ];
  const recordViolations = curriculum
    .filter(
      ({ visibility, publishedAt }) => visibility === 'visible' && !publishedAt,
    )
    .map(({ record }) =>
      violation(
        'published-at-set',
        record,
        'visible, but publishedAt is not set',
      ),
    );
  return [...courseViolations, ...recordViolations];
};

// 8. completedAt is set exactly when the status is completed, on lesson
// progress and on enrolments: the recalculation sets both together.
export const checkCompletedAtIffCompleted = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  [
    ...snapshot.progress.map(
      ({ userId, courseId, lessonId, status, completedAt }) => ({
        record: { userId, courseId, lessonId },
        status,
        completedAt,
      }),
    ),
    ...snapshot.enrolments.map(({ userId, courseId, status, completedAt }) => ({
      record: { userId, courseId },
      status,
      completedAt,
    })),
  ]
    .filter(
      ({ status, completedAt }) =>
        (status === 'completed') !== (completedAt !== undefined),
    )
    .map(({ record, status, completedAt }) =>
      violation(
        'completed-at-iff-completed',
        record,
        completedAt
          ? `completedAt is set, but the status is ${status}`
          : 'completed, but completedAt is not set',
      ),
    );

// 9. Every module, lesson and content item sits under records that exist:
// its course, module and lesson, in the same course and module.
export const checkCurriculumHasParents = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const courses = new Set(snapshot.courses.map(({ courseId }) => courseId));
  const modules = new Set(
    snapshot.modules.map(({ courseId, moduleId }) => `${courseId} ${moduleId}`),
  );
  const lessons = new Set(
    snapshot.lessons.map(
      ({ courseId, moduleId, lessonId }) =>
        `${courseId} ${moduleId} ${lessonId}`,
    ),
  );
  return [
    ...snapshot.modules
      .filter(({ courseId }) => !courses.has(courseId))
      .map(({ courseId, moduleId }) =>
        violation(
          'curriculum-has-parents',
          { courseId, moduleId },
          'its course is missing',
        ),
      ),
    ...snapshot.lessons
      .filter(
        ({ courseId, moduleId }) => !modules.has(`${courseId} ${moduleId}`),
      )
      .map(({ courseId, moduleId, lessonId }) =>
        violation(
          'curriculum-has-parents',
          { courseId, moduleId, lessonId },
          'its module is missing',
        ),
      ),
    ...snapshot.contentItems
      .filter(
        ({ courseId, moduleId, lessonId }) =>
          !lessons.has(`${courseId} ${moduleId} ${lessonId}`),
      )
      .map(({ courseId, moduleId, lessonId, contentItemId }) =>
        violation(
          'curriculum-has-parents',
          { courseId, moduleId, lessonId, contentItemId },
          'its lesson is missing',
        ),
      ),
  ];
};

// 10. A student's records are for things that exist: an enrolment for a
// course, a completion for a content item, a quiz attempt or summary for a
// quiz. Completions can't outlive their item: every delete refuses an item
// with student activity, and a completion is student activity.
export const checkStudentRecordsHaveTargets = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const courses = new Set(snapshot.courses.map(({ courseId }) => courseId));
  const items = new Map(
    snapshot.contentItems.map((item) => [
      `${item.courseId} ${item.contentItemId}`,
      item,
    ]),
  );
  return [
    ...snapshot.enrolments
      .filter(({ courseId }) => !courses.has(courseId))
      .map(({ userId, courseId }) =>
        violation(
          'student-records-have-targets',
          { userId, courseId },
          'enrolment for a course that does not exist',
        ),
      ),
    ...studentRecords(snapshot).flatMap(({ kind, key }) => {
      const item = items.get(`${key.courseId} ${key.contentItemId}`);
      if (!item) {
        return [
          violation(
            'student-records-have-targets',
            key,
            `${kind} for a content item that does not exist`,
          ),
        ];
      }
      return (kind === 'quiz attempt' || kind === 'quiz summary') &&
        item.type !== 'quiz'
        ? [
            violation(
              'student-records-have-targets',
              key,
              `${kind} for a ${item.type} item`,
            ),
          ]
        : [];
    }),
  ];
};

// 11. Every instructor has a user record, which course.listInstructors reads
// their name from. Written when they sign in (#230).
export const checkInstructorHasUser = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const users = new Set(snapshot.users.map(({ userId }) => userId));
  return snapshot.courseInstructors
    .filter(({ instructorId }) => !users.has(instructorId))
    .map(({ courseId, instructorId }) =>
      violation(
        'instructor-has-user',
        { courseId, instructorId },
        'the instructor has no user record',
      ),
    );
};

// 12. A student's completions and quiz records belong to an enrolment in
// that course: completing an item and attempting a quiz both require one, and
// enrolments are kept when a student drops out.
export const checkStudentRecordsEnrolled = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const enrolled = new Set(
    snapshot.enrolments.map(({ userId, courseId }) => `${userId} ${courseId}`),
  );
  return studentRecords(snapshot)
    .filter(({ userId, courseId }) => !enrolled.has(`${userId} ${courseId}`))
    .map(({ kind, key }) =>
      violation(
        'student-records-enrolled',
        key,
        `${kind} by a student not enrolled in the course`,
      ),
    );
};

// 13. Students only enrol in a course that has been published: course.enrol
// requires it, and a course never loses its publishedAt.
export const checkEnrolmentInPublishedCourse = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const courses = new Map(
    snapshot.courses.map((course) => [course.courseId, course]),
  );
  return snapshot.enrolments
    .filter(({ courseId }) => {
      const course = courses.get(courseId);
      return course !== undefined && !course.publishedAt;
    })
    .map(({ userId, courseId }) =>
      violation(
        'enrolment-in-published-course',
        { userId, courseId },
        'enrolled in a course that has never been published',
      ),
    );
};

// 14. Siblings that aren't archived are in a definite order: no two modules
// of a course, lessons of a module or items of a lesson share an `order`. New
// records and restored ones go after the last, and a reorder rewrites them
// all; archived ones keep the order they had, so they're left out.
export const checkSiblingOrderUnique = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const duplicates = <T extends { order: number; archivedAt?: string }>(
    records: T[],
    parent: (record: T) => Record<string, string>,
    kind: string,
  ) =>
    [
      ...groupBy(
        records.filter(({ archivedAt }) => !archivedAt),
        (record) => `${JSON.stringify(parent(record))} ${record.order}`,
      ).values(),
    ]
      .filter((siblings) => siblings.length > 1)
      .map((siblings) =>
        violation(
          'sibling-order-unique',
          { ...parent(siblings[0]), order: String(siblings[0].order) },
          `${siblings.length} ${kind} share this order`,
        ),
      );
  return [
    ...duplicates(
      snapshot.modules,
      ({ courseId }) => ({ courseId }),
      'modules',
    ),
    ...duplicates(
      snapshot.lessons,
      ({ courseId, moduleId }) => ({ courseId, moduleId }),
      'lessons',
    ),
    ...duplicates(
      snapshot.contentItems,
      ({ courseId, lessonId }) => ({ courseId, lessonId }),
      'content items',
    ),
  ];
};

// 15. A student's records name the module and lesson their item is in: they
// copy them from the item, and items never move between lessons. (A record
// whose item is gone is checkStudentRecordsHaveTargets' to report.)
export const checkStudentRecordsPlacedWithItem = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const items = new Map(
    snapshot.contentItems.map((item) => [
      `${item.courseId} ${item.contentItemId}`,
      item,
    ]),
  );
  return studentRecords(snapshot).flatMap(
    ({ kind, key, moduleId, lessonId }) => {
      const item = items.get(`${key.courseId} ${key.contentItemId}`);
      return item && (item.moduleId !== moduleId || item.lessonId !== lessonId)
        ? [
            violation(
              'student-records-placed-with-item',
              key,
              `${kind} is filed under module ${moduleId}, lesson ${lessonId}, but the item is in module ${item.moduleId}, lesson ${item.lessonId}`,
            ),
          ]
        : [];
    },
  );
};

// 16. An enrolment's lastActivityAt is the student's latest activity in the
// course: it's set, in the same transaction, to the time of each completion
// quiz attempt and assignment submission. It orders "Continue where you left off".
export const checkLastActivityAtCurrent = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const latest = new Map<string, string>();
  for (const { userId, courseId, at } of [
    ...snapshot.itemCompletions.map((r) => ({ ...r, at: r.completedAt })),
    ...snapshot.quizAttempts.map((r) => ({ ...r, at: r.submittedAt })),
    ...snapshot.assignmentSubmissions.map((r) => ({ ...r, at: r.submittedAt })),
  ]) {
    const key = `${userId} ${courseId}`;
    const current = latest.get(key);
    if (current === undefined || at > current) {
      latest.set(key, at);
    }
  }
  return snapshot.enrolments.flatMap(({ userId, courseId, lastActivityAt }) => {
    const expected = latest.get(`${userId} ${courseId}`);
    return expected !== undefined &&
      (lastActivityAt === undefined || lastActivityAt < expected)
      ? [
          violation(
            'last-activity-at-current',
            { userId, courseId },
            `lastActivityAt is ${lastActivityAt ?? 'not set'}, but the latest activity was at ${expected}`,
          ),
        ]
      : [];
  });
};

// 17. Nothing in a draft course is archived: a draft has never been open to
// students, so its deletes are permanent, and a course that has been
// published never goes back to draft.
export const checkDraftCourseNothingArchived = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const drafts = new Set(
    snapshot.courses
      .filter(({ status }) => status === 'draft')
      .map(({ courseId }) => courseId),
  );
  return [
    ...snapshot.modules.map((r) => ({
      ...r,
      key: { courseId: r.courseId, moduleId: r.moduleId },
    })),
    ...snapshot.lessons.map((r) => ({
      ...r,
      key: { courseId: r.courseId, lessonId: r.lessonId },
    })),
    ...snapshot.contentItems.map((r) => ({
      ...r,
      key: { courseId: r.courseId, contentItemId: r.contentItemId },
    })),
  ]
    .filter(({ courseId, archivedAt }) => archivedAt && drafts.has(courseId))
    .map(({ key }) =>
      violation(
        'draft-course-nothing-archived',
        key,
        'archived in a draft course',
      ),
    );
};

// 18. Every module, lesson and content item has an `order` its parent handed
// out: no higher than the parent's lastChildOrder. Adding or restoring one
// claims the next order from the parent in the same transaction (#71), and a
// reorder only rearranges orders already handed out, so a record above it
// was written without a claim, and could share its order with a sibling
// added at the same moment.
export const checkChildOrderClaimed = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const lastChildOrders = new Map<string, number | undefined>([
    ...snapshot.courses.map(
      ({ courseId, lastChildOrder }) =>
        [JSON.stringify({ courseId }), lastChildOrder] as const,
    ),
    ...snapshot.modules.map(
      ({ courseId, moduleId, lastChildOrder }) =>
        [JSON.stringify({ courseId, moduleId }), lastChildOrder] as const,
    ),
    ...snapshot.lessons.map(
      ({ courseId, moduleId, lessonId, lastChildOrder }) =>
        [
          JSON.stringify({ courseId, moduleId, lessonId }),
          lastChildOrder,
        ] as const,
    ),
  ]);
  const unclaimed = <T extends { order: number }>(
    children: T[],
    parent: (child: T) => Record<string, string>,
    key: (child: T) => Record<string, string>,
  ) =>
    children.flatMap((child) => {
      const parentKey = JSON.stringify(parent(child));
      // A missing parent is checkCurriculumHasParents' to report.
      if (!lastChildOrders.has(parentKey)) {
        return [];
      }
      const lastChildOrder = lastChildOrders.get(parentKey) ?? 0;
      return child.order > lastChildOrder
        ? [
            violation(
              'child-order-claimed',
              key(child),
              `order ${child.order} is above its parent's lastChildOrder (${lastChildOrder})`,
            ),
          ]
        : [];
    });
  return [
    ...unclaimed(
      snapshot.modules,
      ({ courseId }) => ({ courseId }),
      ({ courseId, moduleId }) => ({ courseId, moduleId }),
    ),
    ...unclaimed(
      snapshot.lessons,
      ({ courseId, moduleId }) => ({ courseId, moduleId }),
      ({ courseId, moduleId, lessonId }) => ({ courseId, moduleId, lessonId }),
    ),
    ...unclaimed(
      snapshot.contentItems,
      ({ courseId, moduleId, lessonId }) => ({ courseId, moduleId, lessonId }),
      ({ courseId, lessonId, contentItemId }) => ({
        courseId,
        lessonId,
        contentItemId,
      }),
    ),
  ];
};

// 19 (assignments, #102). An assignment lesson holds exactly one content item,
// a quiz or an upload assignment, and an upload assignment is only ever in an
// assignment lesson. Creating one writes the lesson and its item together, and
// the item can't be added to, removed or archived separately from its lesson,
// so a lesson with none, several, or the wrong type was written outside that.
export const checkAssignmentLessonShape = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const itemsByLesson = groupBy(
    snapshot.contentItems,
    ({ courseId, moduleId, lessonId }) =>
      JSON.stringify({ courseId, moduleId, lessonId }),
  );
  const lessonKeys = new Set(
    snapshot.lessons
      .filter(({ kind }) => kind === 'assignment')
      .map(({ courseId, moduleId, lessonId }) =>
        JSON.stringify({ courseId, moduleId, lessonId }),
      ),
  );
  const fromLessons = snapshot.lessons
    .filter(({ kind }) => kind === 'assignment')
    .flatMap(({ courseId, moduleId, lessonId }) => {
      const record = { courseId, moduleId, lessonId };
      const items =
        itemsByLesson.get(JSON.stringify({ courseId, moduleId, lessonId })) ??
        [];
      if (items.length !== 1) {
        return [
          violation(
            'assignment-lesson-shape',
            record,
            `assignment lesson has ${items.length} content items, not 1`,
          ),
        ];
      }
      return items[0].type === 'quiz' || items[0].type === 'assignment'
        ? []
        : [
            violation(
              'assignment-lesson-shape',
              record,
              `assignment lesson holds a ${items[0].type} item`,
            ),
          ];
    });
  const fromItems = snapshot.contentItems
    .filter(
      ({ type, courseId, moduleId, lessonId }) =>
        type === 'assignment' &&
        !lessonKeys.has(JSON.stringify({ courseId, moduleId, lessonId })),
    )
    .map(({ courseId, lessonId, contentItemId }) =>
      violation(
        'assignment-lesson-shape',
        { courseId, lessonId, contentItemId },
        "upload assignment isn't in an assignment lesson",
      ),
    );
  return [...fromLessons, ...fromItems];
};

// 20 (submissions, #102). An assignment submission holds one file with a key,
// name, size and type, in the student's own folder of its item
// (`…/content-items/<id>/submissions/<userId>/`); it is for an upload
// assignment, has a version from 1, and comes with the item's completion,
// which the same transaction wrote. `late` isn't checked against the item's
// dueAt: it describes the due date at submit time, and an instructor may move
// or remove the date afterwards.
export const checkAssignmentSubmissionShape = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const items = new Map(
    snapshot.contentItems.map((item) => [
      `${item.courseId} ${item.contentItemId}`,
      item,
    ]),
  );
  const completed = new Set(
    snapshot.itemCompletions.map(
      ({ userId, courseId, contentItemId }) =>
        `${userId} ${courseId} ${contentItemId}`,
    ),
  );
  return snapshot.assignmentSubmissions.flatMap((submission) => {
    const { userId, courseId, contentItemId, file, version } = submission;
    const record = { userId, courseId, contentItemId };
    const problems: string[] = [];
    if (!file?.key || !file.fileName || !file.fileSize || !file.mimeType) {
      problems.push('file is missing its key, name, size or type');
    }
    if (!(version >= 1)) {
      problems.push(`version is ${version}, not at least 1`);
    }
    const item = items.get(`${courseId} ${contentItemId}`);
    if (item) {
      if (item.type !== 'assignment') {
        problems.push(`submitted to a ${item.type} item`);
      }
      const folder = `courses/${courseId}/modules/${item.moduleId}/lessons/${item.lessonId}/content-items/${contentItemId}/submissions/${userId}/`;
      if (file?.key && !file.key.startsWith(folder)) {
        problems.push(`file is outside the student's folder ${folder}`);
      }
    }
    if (!completed.has(`${userId} ${courseId} ${contentItemId}`)) {
      problems.push('has no completion of the item');
    }
    return problems.map((message) =>
      violation('assignment-submission-shape', record, message),
    );
  });
};

// 21 (certificates). A certificate's ID is 16 characters of the Crockford
// alphabet and unique across certificates, it carries the name, title and
// dates printed on it, and it wasn't issued before the course was completed.
export const checkCertificateShape = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
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

// 22 (certificates). A certificate is for a completed enrolment, with the
// same completedAt, in a course that exists. Certificates off for the course
// is not a violation (the setting isn't retroactive), nor is a completed
// enrolment without a certificate (no backfill).
export const checkCertificateHasCompletedEnrolment = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
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
    } else if (enrolment.status !== 'completed') {
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

// 23 (video positions). A saved position is whole seconds from 0 to the cap,
// for a named version of the video. Positions are deliberately not in
// studentRecords (and so not in the targets and placement checks above): a
// position isn't student activity, and deleting a video with watchers is
// allowed, so a position may outlive its item (research R-6). Only its
// shape is checked.
export const checkVideoPositionValid = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.videoPositions.flatMap((position) => {
    const { userId, courseId, lessonId, contentItemId } = position;
    const record = { userId, courseId, lessonId, contentItemId };
    const problems: string[] = [];
    if (!isValidPosition(position.positionSeconds)) {
      problems.push(
        `position ${position.positionSeconds} is not whole seconds from 0 to 86,400`,
      );
    }
    if (!position.versionId) {
      problems.push('no versionId');
    }
    return problems.map((message) =>
      violation('video-position-valid', record, message),
    );
  });

// 26. A course's analytics aggregates equal the sums of what its records
// contribute: `contributions` (helpers/analytics.ts) summed over its
// enrolments, completions and quiz attempts. The stream handler keeps them
// current a few seconds behind the records, so a check right after a change
// may see a difference that closes (the e2e suite waits, see
// `waitForAnalytics`). A missing item counts as zeros. The summary, period and
// lesson items are compared so far; the quiz aggregates are not written yet.
// A lesson's counts come from each student's `progress` against their
// enrolment (a dropped one counts nothing); the funnel markers are ignored.
export const checkAnalyticsMatchesRecords = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const expected = aggregatesOf(
    sumContributions([
      ...snapshot.enrolments.map((r) => contributions('enrolment', r)),
      ...snapshot.itemCompletions.map((r) =>
        contributions('itemCompletion', r),
      ),
      ...snapshot.quizAttempts.map((r) => contributions('quizAttempt', r)),
      ...snapshot.enrolments.map((enrolled) =>
        funnelContributions(
          snapshot.progress.filter(
            (p) =>
              p.courseId === enrolled.courseId && p.userId === enrolled.userId,
          ),
          enrolled,
        ),
      ),
    ]),
  );
  const stored = [
    ...snapshot.courseStats.map(({ courseId, ...counters }) => ({
      courseId,
      sk: 'SUMMARY',
      counters: counters as Record<string, number | undefined>,
    })),
    ...snapshot.periodStats.map(({ courseId, periodKey, ...counters }) => ({
      courseId,
      sk: periodKey,
      counters: counters as Record<string, number | undefined>,
    })),
    ...snapshot.lessonStats.map(({ courseId, lessonId, ...counters }) => ({
      courseId,
      sk: `LESSON#${lessonId}`,
      counters: counters as Record<string, number | undefined>,
    })),
  ];

  const items = new Map<
    string,
    {
      courseId: string;
      sk: string;
      expected: Record<string, number>;
      stored: Record<string, number | undefined>;
    }
  >();
  const entry = (courseId: string, sk: string) => {
    const key = `${courseId} ${sk}`;
    const found = items.get(key) ?? { courseId, sk, expected: {}, stored: {} };
    items.set(key, found);
    return found;
  };
  for (const item of expected) {
    entry(item.courseId, item.sk).expected = item.counters;
  }
  for (const item of stored) {
    entry(item.courseId, item.sk).stored = item.counters;
  }

  return [...items.values()].flatMap(({ courseId, sk, expected, stored }) =>
    [...new Set([...Object.keys(expected), ...Object.keys(stored)])]
      .filter((attribute) =>
        [
          'enrolments',
          'completed',
          'dropped',
          'activeLearners',
          'inProgress',
        ].includes(attribute),
      )
      .flatMap((attribute) => {
        const has = stored[attribute] ?? 0;
        const should = expected[attribute] ?? 0;
        return has === should
          ? []
          : [
              violation(
                'analytics-matches-records',
                { courseId, item: sk },
                `${attribute} is ${has}, but its records add up to ${should}`,
              ),
            ];
      }),
  );
};

// 27-31 (notifications). Written only by the helpers in notification.ts,
// notification-read.ts and notification-email.ts; these rules catch a writer
// that went around them. The hour-long limits give delivery's retries and the
// stream router's failure queue time to finish before anything is reported.
const STUCK_AFTER_MS = 60 * 60 * 1000;
const olderThanAnHour = (iso: string | undefined) =>
  iso === undefined || Date.parse(iso) < Date.now() - STUCK_AFTER_MS;

const notificationKey = (n: TableSnapshot['notifications'][number]) => ({
  userId: n.userId,
  occurredAt: n.occurredAt,
  id: n.id,
});

// 27. A user's unreadCount is the number of their notifications that are
// neither marked read nor at or before readThrough.
export const checkNotificationUnreadCountMatches = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.notificationStates.flatMap((state) => {
    const unread = snapshot.notifications.filter(
      (n) =>
        n.userId === state.userId &&
        n.readAt === undefined &&
        (state.readThrough === undefined ||
          `${n.occurredAt}#${n.id}` > state.readThrough),
    ).length;
    return state.unreadCount === unread
      ? []
      : [
          violation(
            'notification-unread-count-matches',
            { userId: state.userId },
            `unreadCount is ${state.unreadCount}, but ${unread} notifications are unread`,
          ),
        ];
  });

// 28. A notification has the shape its writers give it: a registered type,
// a key made of a valid time and id, a link inside the portal, and an email
// state that carries what its state requires and isn't stuck.
export const checkNotificationShape = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.notifications.flatMap((n) => {
    const problems: string[] = [];
    if (!Object.hasOwn(NOTIFICATION_TYPES, n.type)) {
      problems.push(`type ${n.type} is not registered`);
    }
    if (!parseNotificationPosition(`${n.occurredAt}#${n.id}`)) {
      problems.push(
        `sort key ${n.occurredAt}#${n.id} is not <occurredAt>#<id> of a millisecond ISO time and 16 hex characters`,
      );
    }
    if (!n.link?.path?.startsWith('/')) {
      problems.push('link.path does not start with /');
    }
    const { email } = n;
    if (email.state === 'sent' && !(email.sentAt && email.messageId)) {
      problems.push('email is sent without sentAt and messageId');
    }
    if (
      (email.state === 'skipped' || email.state === 'failed') &&
      !email.reason
    ) {
      problems.push(`email is ${email.state} without a reason`);
    }
    if (email.state === 'sending' && olderThanAnHour(email.claimedAt)) {
      problems.push('email has been sending for over an hour');
    }
    if (email.state === 'pending' && olderThanAnHour(n.createdAt)) {
      problems.push('email is still pending an hour after the notification');
    }
    return problems.map((message) =>
      violation('notification-shape', notificationKey(n), message),
    );
  });

// 29. A user with notifications has a state, with a count that isn't
// negative and a readThrough that is a valid position.
export const checkNotificationStateExists = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const states = new Set(snapshot.notificationStates.map((s) => s.userId));
  const missing = [
    ...new Set(
      snapshot.notifications
        .map((n) => n.userId)
        .filter((userId) => !states.has(userId)),
    ),
  ].map((userId) =>
    violation(
      'notification-state-exists',
      { userId },
      'user has notifications but no notificationState',
    ),
  );
  const bad = snapshot.notificationStates.flatMap((state) => {
    const problems: string[] = [];
    if (!Number.isInteger(state.unreadCount) || state.unreadCount < 0) {
      problems.push(`unreadCount ${state.unreadCount} is not a count`);
    }
    if (
      state.readThrough !== undefined &&
      !parseNotificationPosition(state.readThrough)
    ) {
      problems.push(`readThrough ${state.readThrough} is not a position`);
    }
    return problems.map((message) =>
      violation('notification-state-exists', { userId: state.userId }, message),
    );
  });
  return [...missing, ...bad];
};

// 30. A stored preference is for a registered type whose email can be
// changed: a `required` type is always sent.
export const checkNotificationPreferenceShape = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.notificationPreferences.flatMap((preference) => {
    const { userId, type } = preference;
    const entry = Object.hasOwn(NOTIFICATION_TYPES, type)
      ? NOTIFICATION_TYPES[type]
      : undefined;
    const problem = !entry
      ? `type ${type} is not registered`
      : entry.emailPolicy === 'required'
        ? `type ${type} is required, so its email can't be changed`
        : undefined;
    return problem
      ? [violation('notification-preference-shape', { userId, type }, problem)]
      : [];
  });

// 31. A finished broadcast says when; one still pending after an hour is a
// fan-out that stopped.
export const checkNotificationBroadcastDoneComplete = (
  snapshot: TableSnapshot,
): InvariantViolation[] =>
  snapshot.notificationBroadcasts.flatMap((broadcast) => {
    const record = { id: broadcast.id };
    if (broadcast.status === 'done' && !broadcast.completedAt) {
      return [
        violation(
          'notification-broadcast-done-complete',
          record,
          'broadcast is done without completedAt',
        ),
      ];
    }
    if (
      broadcast.status === 'pending' &&
      olderThanAnHour(broadcast.createdAt)
    ) {
      return [
        violation(
          'notification-broadcast-done-complete',
          record,
          'broadcast has been pending for over an hour',
        ),
      ];
    }
    return [];
  });

const CHECKS = [
  checkCourseHasInstructor,
  checkActivityCountMatchesStudents,
  checkQuizSummaryMatchesAttempts,
  checkProgressMatchesCompletions,
  checkInstructorCourseUpdatedAt,
  checkVideoTranscodeState,
  checkFileItemShape,
  checkPublishedAtSet,
  checkCompletedAtIffCompleted,
  checkCurriculumHasParents,
  checkStudentRecordsHaveTargets,
  checkInstructorHasUser,
  checkStudentRecordsEnrolled,
  checkEnrolmentInPublishedCourse,
  checkSiblingOrderUnique,
  checkStudentRecordsPlacedWithItem,
  checkLastActivityAtCurrent,
  checkDraftCourseNothingArchived,
  checkChildOrderClaimed,
  checkAssignmentLessonShape,
  checkAssignmentSubmissionShape,
  checkCertificateShape,
  checkCertificateHasCompletedEnrolment,
  checkVideoPositionValid,
  checkCaptionTracksValid,
  checkAnalyticsMatchesRecords,
  checkNotificationUnreadCountMatches,
  checkNotificationShape,
  checkNotificationStateExists,
  checkNotificationPreferenceShape,
  checkNotificationBroadcastDoneComplete,
];

// Every violation in the snapshot, by every check.
export const checkTableInvariants = (
  snapshot: TableSnapshot,
): InvariantViolation[] => CHECKS.flatMap((check) => check(snapshot));

// Reads every record the checks need. Scans the whole table, so it's for
// local and test tables, not a deployed one.
export const loadTableSnapshot = async (
  coreTable: Awaited<ReturnType<typeof createCoreTableService>>,
): Promise<TableSnapshot> => {
  const { entities } = coreTable;
  const all = { pages: 'all' } as const;
  const [
    courses,
    modules,
    lessons,
    contentItems,
    courseInstructors,
    enrolments,
    itemCompletions,
    progress,
    quizAttempts,
    quizSummaries,
    assignmentSubmissions,
    certificates,
    videoPositions,
    users,
    courseStats,
    periodStats,
    lessonStats,
    quizQuestionStats,
    quizScoreStats,
    notifications,
    notificationStates,
    notificationPreferences,
    notificationBroadcasts,
  ] = await Promise.all([
    entities.course.scan.go(all),
    entities.module.scan.go(all),
    entities.lesson.scan.go(all),
    entities.contentItem.scan.go(all),
    entities.courseInstructor.scan.go(all),
    entities.enrolment.scan.go(all),
    entities.itemCompletion.scan.go(all),
    entities.progress.scan.go(all),
    entities.quizAttempt.scan.go(all),
    entities.quizSummary.scan.go(all),
    entities.assignmentSubmission.scan.go(all),
    entities.certificate.scan.go(all),
    entities.videoPosition.scan.go(all),
    entities.user.scan.go(all),
    entities.courseStats.scan.go(all),
    entities.periodStats.scan.go(all),
    entities.lessonStats.scan.go(all),
    entities.quizQuestionStats.scan.go(all),
    entities.quizScoreStats.scan.go(all),
    entities.notification.scan.go(all),
    entities.notificationState.scan.go(all),
    entities.notificationPreference.scan.go(all),
    entities.notificationBroadcast.scan.go(all),
  ]);
  return {
    courses: courses.data,
    modules: modules.data,
    lessons: lessons.data,
    contentItems: contentItems.data,
    courseInstructors: courseInstructors.data,
    enrolments: enrolments.data,
    itemCompletions: itemCompletions.data,
    progress: progress.data,
    quizAttempts: quizAttempts.data,
    quizSummaries: quizSummaries.data,
    assignmentSubmissions: assignmentSubmissions.data,
    certificates: certificates.data,
    videoPositions: videoPositions.data,
    users: users.data,
    courseStats: courseStats.data,
    periodStats: periodStats.data,
    lessonStats: lessonStats.data,
    quizQuestionStats: quizQuestionStats.data,
    quizScoreStats: quizScoreStats.data,
    notifications: notifications.data,
    notificationStates: notificationStates.data,
    notificationPreferences: notificationPreferences.data,
    notificationBroadcasts: notificationBroadcasts.data,
  };
};
