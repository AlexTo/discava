/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { EntityItem } from 'electrodb';
import type { createContentItemEntity } from '../entities/content-item.js';
import type { createCourseEntity } from '../entities/course.js';
import type { createCourseInstructorEntity } from '../entities/course-instructor.js';
import type { createEnrolmentEntity } from '../entities/enrolment.js';
import type { createItemCompletionEntity } from '../entities/item-completion.js';
import type { createLessonEntity } from '../entities/lesson.js';
import type { createModuleEntity } from '../entities/module.js';
import type { createProgressEntity } from '../entities/progress.js';
import type { createQuizAttemptEntity } from '../entities/quiz-attempt.js';
import type { createQuizSummaryEntity } from '../entities/quiz-summary.js';
import type { createUserEntity } from '../entities/user.js';
import type { createCoreTableService } from '../service.js';
import { computeProgress } from './progress.js';

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
    | 'transcodePending'
    | 'transcodePendingSince'
    | 'submissionNonce'
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
  users: Pick<Item<typeof createUserEntity>, 'userId'>[];
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
// completions, quiz attempts and quiz summaries.
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
// students with records for it: an itemCompletion, or for a quiz a
// quizSummary. Each is created in the transaction that increments the count,
// and neither is ever removed, so the count is exact. It gates permanent
// deletion, so too low a count could let student data be destroyed.
export const checkActivityCountMatchesStudents = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const students = new Map<string, Set<string>>();
  for (const { contentItemId, userId } of [
    ...snapshot.itemCompletions,
    ...snapshot.quizSummaries,
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
    return problems.map((message) =>
      violation('video-transcode-state', record, message),
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
      return kind !== 'completion' && item.type !== 'quiz'
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
// and quiz attempt. It orders "Continue where you left off".
export const checkLastActivityAtCurrent = (
  snapshot: TableSnapshot,
): InvariantViolation[] => {
  const latest = new Map<string, string>();
  for (const { userId, courseId, at } of [
    ...snapshot.itemCompletions.map((r) => ({ ...r, at: r.completedAt })),
    ...snapshot.quizAttempts.map((r) => ({ ...r, at: r.submittedAt })),
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
    users,
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
    entities.user.scan.go(all),
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
    users: users.data,
  };
};
