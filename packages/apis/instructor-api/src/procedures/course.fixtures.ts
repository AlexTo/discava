/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'vitest';

// What course*.test.ts share: the mocked tables, fixture records and
// default mock behaviour. A test file takes its spies from `spies`, which has to
// be hoisted above the procedure imports, so this module imports no procedure.

export const spies = {
  courseCreate: vi.fn(),
  courseGet: vi.fn(),
  coursePreviewGet: vi.fn(),
  coursePatch: vi.fn(),
  coursePatchSet: vi.fn(),
  coursePatchRemove: vi.fn(),
  paymentConnectionGet: vi.fn(),
  coursePatchWhere: vi.fn(),
  coursePatchGo: vi.fn(),
  coursePatchCommit: vi.fn(),
  moduleCheck: vi.fn(),
  lessonCheck: vi.fn(),
  contentItemCheck: vi.fn(),
  courseInstructorCreate: vi.fn(),
  courseInstructorGet: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseInstructorPatch: vi.fn(),
  courseInstructorPatchSet: vi.fn(),
  transactionWrite: vi.fn(),
  transactionGo: vi.fn(),
  curriculumCollection: vi.fn(),
  ensureProfile: vi.fn(),
};
export const {
  courseCreate,
  courseGet,
  coursePreviewGet,
  coursePatch,
  coursePatchSet,
  coursePatchRemove,
  paymentConnectionGet,
  coursePatchWhere,
  coursePatchGo,
  coursePatchCommit,
  moduleCheck,
  lessonCheck,
  contentItemCheck,
  courseInstructorCreate,
  courseInstructorGet,
  courseInstructorQueryPrimary,
  courseInstructorPatch,
  courseInstructorPatchSet,
  transactionWrite,
  transactionGo,
  curriculumCollection,
  ensureProfile,
} = spies;

export const INSTRUCTOR_SUB = 'instructor-1';

export const course = {
  courseId: 'course-1',
  title: 'Intro to DynamoDB',
  status: 'draft' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  certificatesEnabled: true,
  certificateCriteria: { version: 1, requireQuizPass: false },
  priceAmount: 0,
  priceCurrency: 'USD',
};

export type CheckCondition = (
  attr: Record<string, string>,
  op: Record<string, (...args: string[]) => string>,
) => string;

// The `where` callback each guard in the publish transaction was given.
export const checkConditions: Record<string, CheckCondition> = {};

// A module, lesson and content item that students would see.
export const visibleCurriculum = {
  module: [{ moduleId: 'm1', visibility: 'visible' }],
  lesson: [{ lessonId: 'l1', moduleId: 'm1', visibility: 'visible' }],
  contentItem: [
    {
      contentItemId: 'c1',
      lessonId: 'l1',
      moduleId: 'm1',
      visibility: 'visible',
    },
  ],
};

export const conditionalCheckFailed = () =>
  Object.assign(new Error('ElectroDB error'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

export const givenCourse = (data: Record<string, unknown>) =>
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { ...course, ...data } }),
  });

// Runs the `where` callback the way ElectroDB would, returning the condition.
export const conditionOf = () => {
  const condition = coursePatchWhere.mock.calls[0][0] as (
    attr: Record<string, string>,
    op: Record<string, (...args: string[]) => string>,
  ) => string;
  return condition(
    { status: 'status' },
    { eq: (attribute, value) => `${attribute} = ${value}` },
  );
};

export const conditionText = (condition: CheckCondition) =>
  condition(
    { visibility: 'visibility', archivedAt: 'archivedAt' },
    {
      eq: (attribute, value) => `${attribute} = ${value}`,
      notExists: (attribute) => `attribute_not_exists(${attribute})`,
    },
  );

// The course reads as a draft, then (once the transaction commits) as published.
export const givenPublishCommits = (published: Record<string, unknown>) =>
  courseGet
    .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: course }) })
    .mockReturnValueOnce({
      go: vi.fn().mockResolvedValue({
        data: { ...course, status: 'published', ...published },
      }),
    });

export const installDefaults = () => {
  vi.clearAllMocks();
  // A course has no preview, unless a test says otherwise.
  coursePreviewGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: null }),
  });

  courseCreate.mockImplementation((attrs) => ({
    commit: () => ({ item: null, attrs }),
  }));
  ensureProfile.mockResolvedValue({ status: 'exists' });
  courseInstructorCreate.mockImplementation((attrs) => ({
    commit: () => ({ item: null, attrs }),
  }));
  transactionWrite.mockImplementation((fn) => {
    fn({
      course: { create: courseCreate, patch: coursePatch },
      courseInstructor: { create: courseInstructorCreate },
      module: { check: moduleCheck },
      lesson: { check: lessonCheck },
      contentItem: { check: contentItemCheck },
    });
    return { go: transactionGo };
  });
  transactionGo.mockResolvedValue({ canceled: false, data: [] });
  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: course }),
  });

  coursePatch.mockReturnValue({ set: coursePatchSet });
  // The result of whichever patch a test runs; archive's default.
  coursePatchGo.mockResolvedValue({ data: { ...course, status: 'archived' } });
  coursePatchSet.mockReturnValue({
    go: coursePatchGo,
    where: coursePatchWhere,
    remove: coursePatchRemove,
  });
  coursePatchRemove.mockReturnValue({
    go: coursePatchGo,
    where: coursePatchWhere,
  });
  // Payments are connected, unless a test says otherwise.
  paymentConnectionGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { status: 'active' } }),
  });
  coursePatchWhere.mockReturnValue({
    go: coursePatchGo,
    commit: coursePatchCommit,
  });
  // A guard on a record the course's visible content depends on; the
  // `where` callbacks are kept so tests can read the condition.
  for (const [name, check] of Object.entries({
    module: moduleCheck,
    lesson: lessonCheck,
    contentItem: contentItemCheck,
  })) {
    check.mockImplementation(() => ({
      where: (condition: CheckCondition) => {
        checkConditions[name] = condition;
        return { commit: () => ({}) };
      },
    }));
  }
  curriculumCollection.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { course: [course], ...visibleCurriculum },
    }),
  });
  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: course.courseId, instructorId: INSTRUCTOR_SUB },
    }),
  });
  courseInstructorQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: [{ courseId: course.courseId, instructorId: INSTRUCTOR_SUB }],
    }),
  });
  courseInstructorPatch.mockReturnValue({ set: courseInstructorPatchSet });
  courseInstructorPatchSet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: undefined }),
  });
};
