/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'vitest';

// What course*.test.ts share: the mocked tables, fixture records and
// default mock behaviour. A test file takes its spies from `spies`, which has to
// be hoisted above the procedure imports, so this module imports no procedure.

export const spies = {
  courseInstructorQueryByInstructor: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseQueryByStatus: vi.fn(),
  courseGet: vi.fn(),
  userGet: vi.fn(),
  enrolmentGet: vi.fn(),
  courseRatingGet: vi.fn(),
  instructorProfileGet: vi.fn(),
  categoryGet: vi.fn(),
  coursePreviewGet: vi.fn(),
  getSignedCloudFrontCookies: vi.fn(),
  curriculumCollection: vi.fn(),
};
export const {
  courseInstructorQueryByInstructor,
  courseInstructorQueryPrimary,
  courseQueryByStatus,
  courseGet,
  userGet,
  enrolmentGet,
  courseRatingGet,
  instructorProfileGet,
  categoryGet,
  coursePreviewGet,
  getSignedCloudFrontCookies,
  curriculumCollection,
} = spies;

export const USER_SUB = 'user-1';

// Curriculum records as stored: every module, lesson and content item has a
// visibility. Output schemas don't expose it to students, so expectations use
// the plain fixtures.
export const visible = <T extends object>(record: T) => ({
  ...record,
  visibility: 'visible' as const,
});

export const course = {
  courseId: 'course-1',
  title: 'Intro to DynamoDB',
  status: 'draft' as const,
  priceAmount: 0,
  priceCurrency: 'USD',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const enrolment = (
  status: 'active' | 'completed' | 'dropped' = 'active',
) => ({
  courseId: 'course-1',
  userId: USER_SUB,
  status,
  progressPercent: 0,
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
});

export const installDefaults = () => {
  vi.clearAllMocks();
  // No course is rated, unless a test says otherwise.
  courseRatingGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [], unprocessed: [] }),
  });
  // A course has no instructors and no category, unless a test says otherwise.
  courseInstructorQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  instructorProfileGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [], unprocessed: [] }),
  });
  categoryGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: null }),
  });
  // A course has no preview, unless a test says otherwise.
  coursePreviewGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: null }),
  });
  getSignedCloudFrontCookies.mockResolvedValue(['CloudFront-Policy=abc']);
  // The caller is enrolled, unless a test says otherwise.
  enrolmentGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: enrolment() }),
  });
};
