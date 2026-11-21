/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Check, groupBy, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// Every course has at least one instructor. Kept by course.create's
// transaction; nothing removes an instructor yet.
export const checkCourseHasInstructor = (
  snapshot: TableSnapshot,
): Violation[] => {
  const taught = new Set(snapshot.courseInstructors.map((c) => c.courseId));
  return snapshot.courses
    .filter(({ courseId }) => !taught.has(courseId))
    .map(({ courseId }) =>
      violation('course-has-instructor', { courseId }, 'has no instructor'),
    );
};

// Each courseInstructor's courseUpdatedAt is its course's updatedAt: it
// orders an instructor's course list, and every procedure that writes a
// course copies it to the course's instructors.
export const checkInstructorCourseUpdatedAt = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// publishedAt records the first time something was open to students: a
// published course has one and a draft course doesn't (publishing sets it,
// and restoring an archived course sends it back to draft only without one);
// a visible module, lesson or content item has one, since every write that
// makes a record visible sets it if it isn't already.
export const checkPublishedAtSet = (snapshot: TableSnapshot): Violation[] => {
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

// Every module, lesson and content item sits under records that exist:
// its course, module and lesson, in the same course and module.
export const checkCurriculumHasParents = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// Every instructor has a user record, which course.listInstructors reads
// their name from. Written when they sign in (#230).
export const checkInstructorHasUser = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// Siblings that aren't archived are in a definite order: no two modules
// of a course, lessons of a module or items of a lesson share an `order`. New
// records and restored ones go after the last, and a reorder rewrites them
// all; archived ones keep the order they had, so they're left out.
export const checkSiblingOrderUnique = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// Nothing in a draft course is archived: a draft has never been open to
// students, so its deletes are permanent, and a course that has been
// published never goes back to draft.
export const checkDraftCourseNothingArchived = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// Every module, lesson and content item has an `order` its parent handed
// out: no higher than the parent's lastChildOrder. Adding or restoring one
// claims the next order from the parent in the same transaction (#71), and a
// reorder only rearranges orders already handed out, so a record above it
// was written without a claim, and could share its order with a sibling
// added at the same moment.
export const checkChildOrderClaimed = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// An assignment lesson holds exactly one content item,
// a quiz or an upload assignment, and an upload assignment is only ever in an
// assignment lesson. Creating one writes the lesson and its item together, and
// the item can't be added to, removed or archived separately from its lesson,
// so a lesson with none, several, or the wrong type was written outside that.
export const checkAssignmentLessonShape = (
  snapshot: TableSnapshot,
): Violation[] => {
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

// A lesson is marked as a free preview by `lesson.setFreePreview`, which sets
// `freePreview` to true on a lesson of kind `lesson` and removes the attribute
// to unmark it. So a stored `false`, or a mark on an assignment lesson, was
// written some other way.
export const checkFreePreviewOnOrdinaryLesson = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.lessons
    .filter(({ freePreview }) => freePreview !== undefined)
    .flatMap(({ courseId, moduleId, lessonId, kind, freePreview }) => {
      const record = { courseId, moduleId, lessonId };
      return [
        ...(freePreview === true
          ? []
          : [
              violation(
                'free-preview-on-ordinary-lesson',
                record,
                `lesson stores freePreview ${String(freePreview)}, not true`,
              ),
            ]),
        ...(kind === 'lesson'
          ? []
          : [
              violation(
                'free-preview-on-ordinary-lesson',
                record,
                `${kind} lesson is marked as a free preview`,
              ),
            ]),
      ];
    });

// A video holds at most 20 questions with unique ids, and a key with exactly
// their ids; `quizVersion` is set once either exists. Only a quiz or a video
// holds any of the three. Saving a video's questions writes the three
// together, so a mismatch was written outside that.
const MAX_VIDEO_QUESTIONS = 20;

export const checkVideoQuestionsShape = (
  snapshot: TableSnapshot,
): Violation[] =>
  snapshot.contentItems.flatMap(
    ({
      courseId,
      lessonId,
      contentItemId,
      type,
      questions,
      answerKey,
      quizVersion,
    }) => {
      const record = { courseId, lessonId, contentItemId };
      const problem = (message: string) => [
        violation('video-questions-shape', record, message),
      ];
      const hasAny =
        questions !== undefined ||
        answerKey !== undefined ||
        quizVersion !== undefined;
      if (type === 'quiz') {
        return [];
      }
      if (type !== 'video') {
        return hasAny ? problem(`${type} item holds video questions`) : [];
      }
      if (!hasAny) {
        return [];
      }
      if (quizVersion === undefined) {
        return problem('video has questions or a key but no quizVersion');
      }
      const list = (questions ?? []) as { questionId: string }[];
      if (list.length > MAX_VIDEO_QUESTIONS) {
        return problem(
          `video has ${list.length} questions, over ${MAX_VIDEO_QUESTIONS}`,
        );
      }
      const ids = list.map((question) => question.questionId);
      if (new Set(ids).size !== ids.length) {
        return problem('video questions share an id');
      }
      const keyIds = Object.keys(answerKey ?? {});
      return keyIds.length === ids.length &&
        keyIds.every((id) => ids.includes(id))
        ? []
        : problem("video's answer key doesn't match its questions");
    },
  );

export const CURRICULUM_CHECKS = [
  { name: 'course-has-instructor', check: checkCourseHasInstructor },
  {
    name: 'instructor-course-updated-at',
    check: checkInstructorCourseUpdatedAt,
  },
  { name: 'published-at-set', check: checkPublishedAtSet },
  { name: 'curriculum-has-parents', check: checkCurriculumHasParents },
  { name: 'instructor-has-user', check: checkInstructorHasUser },
  { name: 'sibling-order-unique', check: checkSiblingOrderUnique },
  {
    name: 'draft-course-nothing-archived',
    check: checkDraftCourseNothingArchived,
  },
  { name: 'child-order-claimed', check: checkChildOrderClaimed },
  { name: 'assignment-lesson-shape', check: checkAssignmentLessonShape },
  {
    name: 'free-preview-on-ordinary-lesson',
    check: checkFreePreviewOnOrdinaryLesson,
  },
  { name: 'video-questions-shape', check: checkVideoQuestionsShape },
] as const satisfies readonly Check[];
