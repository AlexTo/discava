/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { computeProgress } from '../progress.js';
import { isValidPosition } from '../video-position.js';
import {
  type Check,
  groupBy,
  studentRecords,
  type Violation,
  violation,
} from './common.js';
import type { TableSnapshot } from './snapshot.js';

// A content item's studentActivityCount is the number of distinct
// students with records for it: an itemCompletion, an assignmentSubmission,
// or for a quiz a quizSummary. Each is created in the transaction that
// increments the count, and none is ever removed, so the count is exact. It gates permanent
// deletion, so too low a count could let student data be destroyed.
export const checkActivityCountMatchesStudents = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// A quizSummary agrees with its student's attempts at that quiz: the
// number used, the best score and which attempt got it, and passedAt set
// exactly when an attempt passed. quiz.submitAttempt writes both in one
// transaction. (Whether attemptsUsed stayed within the attempt limit can't be
// checked afterwards: the limit may have changed since.)
export const checkQuizSummaryMatchesAttempts = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// Each enrolled student's progress is what the progress recalculation
// computes from their completions and the course's effectively visible
// curriculum. Completion is permanent, so a lesson or enrolment already
// completed stays so even once new content makes it incomplete; anything not
// yet completed must match. The recalculation runs from the table's stream,
// so this only holds once it has caught up. An enrolment in a course that
// doesn't exist is left to checkStudentRecordsHaveTargets.
export const checkProgressMatchesCompletions = (
  snapshot: TableSnapshot,
): Violation[] => {
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
      const enrolmentViolations: Violation[] = [];
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

// completedAt is set exactly when the status is completed, on lesson
// progress and on enrolments: the recalculation sets both together. An
// enrolment widens it: a refund ends a completed enrolment (`dropped`)
// without clearing the date, so `dropped` may carry a completedAt too. Even
// so, completed still needs its date, and an active one can't have one.
export const checkCompletedAtIffCompleted = (
  snapshot: TableSnapshot,
): Violation[] =>
  [
    ...snapshot.progress.map(
      ({ userId, courseId, lessonId, status, completedAt }) => ({
        record: { userId, courseId, lessonId },
        status,
        completedAt,
        allowedWithDate: ['completed'] as string[],
      }),
    ),
    ...snapshot.enrolments.map(({ userId, courseId, status, completedAt }) => ({
      record: { userId, courseId },
      status,
      completedAt,
      allowedWithDate: ['completed', 'dropped'] as string[],
    })),
  ]
    .filter(
      ({ status, completedAt, allowedWithDate }) =>
        (status === 'completed' && completedAt === undefined) ||
        (completedAt !== undefined && !allowedWithDate.includes(status)),
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

// A student's records are for things that exist: an enrolment for a
// course, a completion for a content item, a quiz attempt or summary for a
// quiz. Completions can't outlive their item: every delete refuses an item
// with student activity, and a completion is student activity.
export const checkStudentRecordsHaveTargets = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// A student's completions and quiz records belong to an enrolment in
// that course: completing an item and attempting a quiz both require one, and
// enrolments are kept when a student drops out.
export const checkStudentRecordsEnrolled = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// Students only enrol in a course that has been published: course.enrol
// requires it, and a course never loses its publishedAt.
export const checkEnrolmentInPublishedCourse = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// A student's records name the module and lesson their item is in: they
// copy them from the item, and items never move between lessons. (A record
// whose item is gone is checkStudentRecordsHaveTargets' to report.)
export const checkStudentRecordsPlacedWithItem = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// An enrolment's lastActivityAt is the student's latest activity in the
// course: it's set, in the same transaction, to the time of each completion,
// quiz attempt and assignment submission. It orders "Continue where you left
// off".
export const checkLastActivityAtCurrent = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// An assignment submission holds one file with a key,
// name, size and type, in the student's own folder of its item
// (`…/content-items/<id>/submissions/<userId>/`); it is for an upload
// assignment, has a version from 1, and comes with the item's completion,
// which the same transaction wrote. `late` isn't checked against the item's
// dueAt: it describes the due date at submit time, and an instructor may move
// or remove the date afterwards.
export const checkAssignmentSubmissionShape = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// A saved position is whole seconds from 0 to the cap,
// for a named version of the video. Positions are deliberately not in
// studentRecords (and so not in the targets and placement checks above): a
// position isn't student activity, and deleting a video with watchers is
// allowed, so a position may outlive its item (research R-6). Only its
// shape is checked.
export const checkVideoPositionValid = (snapshot: TableSnapshot): Violation[] =>
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

export const STUDENT_ACTIVITY_CHECKS = [
  {
    name: 'activity-count-matches-students',
    check: checkActivityCountMatchesStudents,
  },
  {
    name: 'quiz-summary-matches-attempts',
    check: checkQuizSummaryMatchesAttempts,
  },
  {
    name: 'progress-matches-completions',
    check: checkProgressMatchesCompletions,
  },
  { name: 'completed-at-iff-completed', check: checkCompletedAtIffCompleted },
  {
    name: 'student-records-have-targets',
    check: checkStudentRecordsHaveTargets,
  },
  { name: 'student-records-enrolled', check: checkStudentRecordsEnrolled },
  {
    name: 'enrolment-in-published-course',
    check: checkEnrolmentInPublishedCourse,
  },
  {
    name: 'student-records-placed-with-item',
    check: checkStudentRecordsPlacedWithItem,
  },
  { name: 'last-activity-at-current', check: checkLastActivityAtCurrent },
  {
    name: 'assignment-submission-shape',
    check: checkAssignmentSubmissionShape,
  },
  { name: 'video-position-valid', check: checkVideoPositionValid },
] as const satisfies readonly Check[];
