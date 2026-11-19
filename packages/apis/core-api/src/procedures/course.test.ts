/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  listCoursesByInstructor,
  listInstructorsForCourse,
  publicListCourses,
  publicViewCourse,
  viewCourse,
} from './course.js';

const {
  courseInstructorQueryByInstructor,
  courseInstructorQueryPrimary,
  courseQueryByStatus,
  courseGet,
  userGet,
  enrolmentGet,
  courseRatingGet,
  instructorProfileGet,
  categoryGet,
  curriculumCollection,
} = vi.hoisted(() => ({
  courseInstructorQueryByInstructor: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseQueryByStatus: vi.fn(),
  courseGet: vi.fn(),
  userGet: vi.fn(),
  enrolmentGet: vi.fn(),
  courseRatingGet: vi.fn(),
  instructorProfileGet: vi.fn(),
  categoryGet: vi.fn(),
  curriculumCollection: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: {
        get: courseGet,
        query: { byStatus: courseQueryByStatus },
      },
      user: { get: userGet },
      enrolment: { get: enrolmentGet },
      courseRating: { get: courseRatingGet },
      instructorProfile: { get: instructorProfileGet },
      category: { get: categoryGet },
      courseInstructor: {
        query: {
          byInstructor: courseInstructorQueryByInstructor,
          primary: courseInstructorQueryPrimary,
        },
      },
    },
    collections: {
      curriculum: curriculumCollection,
    },
  })),
}));

const router = t.router({
  listCoursesByInstructor,
  listInstructorsForCourse,
  publicListCourses,
  publicViewCourse,
  viewCourse,
});
const caller = t.createCallerFactory(router);

const USER_SUB = 'user-1';

const buildEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: { authorizer: { claims: { sub: USER_SUB } } },
  }) as unknown as APIGatewayProxyEvent;

const callAsUser = () =>
  caller({ event: buildEvent(), context: {} as any, info: {} as any });

const callAnonymously = () =>
  caller({
    event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

// Curriculum records as stored: every module, lesson and content item has a
// visibility. Output schemas don't expose it to students, so expectations use
// the plain fixtures.
const visible = <T extends object>(record: T) => ({
  ...record,
  visibility: 'visible' as const,
});

const course = {
  courseId: 'course-1',
  title: 'Intro to DynamoDB',
  status: 'draft' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const enrolment = (status: 'active' | 'completed' | 'dropped' = 'active') => ({
  courseId: 'course-1',
  userId: USER_SUB,
  status,
  progressPercent: 0,
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
});

beforeEach(() => {
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
  // The caller is enrolled, unless a test says otherwise.
  enrolmentGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: enrolment() }),
  });
});

describe('listCoursesByInstructor', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().listCoursesByInstructor({
        instructorId: 'instructor-1',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(courseInstructorQueryByInstructor).not.toHaveBeenCalled();
  });

  it('returns an empty page without batch-getting when the instructor teaches nothing', async () => {
    courseInstructorQueryByInstructor.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    const result = await callAsUser().listCoursesByInstructor({
      instructorId: 'instructor-1',
    });

    expect(result).toEqual({ items: [], cursor: null });
    expect(courseGet).not.toHaveBeenCalled();
  });

  it('defaults limit to 10 when the caller omits it', async () => {
    courseInstructorQueryByInstructor.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    await callAsUser().listCoursesByInstructor({
      instructorId: 'instructor-1',
    });

    expect(
      courseInstructorQueryByInstructor.mock.results[0].value.go,
    ).toHaveBeenCalledWith({ cursor: undefined, limit: 10, order: 'desc' });
  });

  it('passes cursor/limit through to the query and forwards the next cursor', async () => {
    courseInstructorQueryByInstructor.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ courseId: 'course-1', instructorId: 'instructor-1' }],
        cursor: 'next-page',
      }),
    });
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course] }),
    });

    const result = await callAsUser().listCoursesByInstructor({
      instructorId: 'instructor-1',
      cursor: 'prev-page',
      limit: 10,
    });

    expect(courseInstructorQueryByInstructor).toHaveBeenCalledWith({
      instructorId: 'instructor-1',
    });
    expect(
      courseInstructorQueryByInstructor.mock.results[0].value.go,
    ).toHaveBeenCalledWith({ cursor: 'prev-page', limit: 10, order: 'desc' });
    expect(courseGet).toHaveBeenCalledWith([{ courseId: 'course-1' }]);
    expect(courseGet.mock.results[0].value.go).toHaveBeenCalledWith({
      preserveBatchOrder: true,
    });
    expect(result).toEqual({ items: [course], cursor: 'next-page' });
  });

  it('filters out null gaps from the batch-get (e.g. a course deleted after its membership row was written)', async () => {
    courseInstructorQueryByInstructor.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: 'course-1', instructorId: 'instructor-1' },
          { courseId: 'deleted-course', instructorId: 'instructor-1' },
        ],
        cursor: null,
      }),
    });
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course, null] }),
    });

    const result = await callAsUser().listCoursesByInstructor({
      instructorId: 'instructor-1',
    });

    expect(result).toEqual({ items: [course], cursor: null });
  });
});

describe('listInstructorsForCourse', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().listInstructorsForCourse({ courseId: course.courseId }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(courseInstructorQueryPrimary).not.toHaveBeenCalled();
  });

  it('returns an empty page without batch-getting when the course has no instructors', async () => {
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    const result = await callAsUser().listInstructorsForCourse({
      courseId: course.courseId,
    });

    expect(result).toEqual({ items: [], cursor: null });
    expect(userGet).not.toHaveBeenCalled();
  });

  it('defaults limit to 10 when the caller omits it', async () => {
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    await callAsUser().listInstructorsForCourse({ courseId: course.courseId });

    expect(
      courseInstructorQueryPrimary.mock.results[0].value.go,
    ).toHaveBeenCalledWith({ cursor: undefined, limit: 10 });
  });

  it('filters out null gaps from the batch-get (e.g. a user deleted after its membership row was written)', async () => {
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [
          { courseId: course.courseId, instructorId: 'instructor-1' },
          { courseId: course.courseId, instructorId: 'deleted-instructor' },
        ],
        cursor: null,
      }),
    });
    const instructor = { userId: 'instructor-1', email: 'a@b.com' };
    userGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [instructor, null] }),
    });

    const result = await callAsUser().listInstructorsForCourse({
      courseId: course.courseId,
    });

    expect(result).toEqual({ items: [instructor], cursor: null });
  });

  it('passes cursor/limit through and batch-gets the instructors teaching a course', async () => {
    courseInstructorQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ courseId: course.courseId, instructorId: 'instructor-1' }],
        cursor: 'next-page',
      }),
    });
    const instructor = { userId: 'instructor-1', email: 'a@b.com' };
    userGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [instructor] }),
    });

    const result = await callAsUser().listInstructorsForCourse({
      courseId: course.courseId,
      cursor: 'prev-page',
      limit: 10,
    });

    expect(courseInstructorQueryPrimary).toHaveBeenCalledWith({
      courseId: course.courseId,
    });
    expect(
      courseInstructorQueryPrimary.mock.results[0].value.go,
    ).toHaveBeenCalledWith({ cursor: 'prev-page', limit: 10 });
    expect(userGet).toHaveBeenCalledWith([{ userId: 'instructor-1' }]);
    expect(userGet.mock.results[0].value.go).toHaveBeenCalledWith({
      preserveBatchOrder: true,
    });
    expect(result).toEqual({ items: [instructor], cursor: 'next-page' });
  });
});

describe('publicListCourses', () => {
  it('allows unauthenticated callers', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course], cursor: null }),
    });

    const result = await callAnonymously().publicListCourses({});

    expect(result).toEqual({
      items: [{ ...course, ratingCount: 0 }],
      cursor: null,
    });
  });

  it('queries only published courses, defaulting limit to 10', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    await callAnonymously().publicListCourses({});

    expect(courseQueryByStatus).toHaveBeenCalledWith({ status: 'published' });
    // Newest first: the sort key is the courseId, a UUIDv7.
    expect(courseQueryByStatus.mock.results[0].value.go).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
      order: 'desc',
    });
  });

  it('passes cursor/limit through and forwards the next cursor', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course], cursor: 'next-page' }),
    });

    const result = await callAnonymously().publicListCourses({
      cursor: 'prev-page',
      limit: 20,
    });

    expect(courseQueryByStatus.mock.results[0].value.go).toHaveBeenCalledWith({
      cursor: 'prev-page',
      limit: 20,
      order: 'desc',
    });
    expect(result).toEqual({
      items: [{ ...course, ratingCount: 0 }],
      cursor: 'next-page',
    });
  });

  it('adds the rating of each course, in the order of the page', async () => {
    const other = { ...course, courseId: 'course-2' };
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [other, course], cursor: null }),
    });
    // Only course-1 is rated: 3 x 5 stars and 1 x 4 stars, 4.75 on average.
    courseRatingGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ courseId: 'course-1', stars4: 1, stars5: 3 }],
        unprocessed: [],
      }),
    });

    const result = await callAnonymously().publicListCourses({});

    expect(result.items).toEqual([
      { ...other, ratingCount: 0 },
      { ...course, ratingAverage: 4.8, ratingCount: 4 },
    ]);
    expect(result.items[0].ratingAverage).toBeUndefined();
  });

  it('reads the ratings of a page with one batch get', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [course, { ...course, courseId: 'course-2' }],
        cursor: null,
      }),
    });

    await callAnonymously().publicListCourses({ limit: 100 });

    expect(courseRatingGet).toHaveBeenCalledTimes(1);
    expect(courseRatingGet).toHaveBeenCalledWith([
      { courseId: 'course-1' },
      { courseId: 'course-2' },
    ]);
  });

  it('reads no ratings for an empty page', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    const result = await callAnonymously().publicListCourses({});

    expect(result).toEqual({ items: [], cursor: null });
    expect(courseRatingGet).not.toHaveBeenCalled();
  });

  it('asks again for ratings DynamoDB left unprocessed', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [course], cursor: null }),
    });
    courseRatingGet
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: [],
          unprocessed: [{ courseId: 'course-1' }],
        }),
      })
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: [{ courseId: 'course-1', stars5: 1 }],
          unprocessed: [],
        }),
      });

    const result = await callAnonymously().publicListCourses({});

    expect(courseRatingGet).toHaveBeenCalledTimes(2);
    expect(result.items[0]).toMatchObject({ ratingAverage: 5, ratingCount: 1 });
  });
});

describe('viewCourse', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      callAnonymously().viewCourse({ courseId: course.courseId }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(curriculumCollection).not.toHaveBeenCalled();
  });

  it('returns the course with an empty curriculum when it has no modules', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [course], module: [], lesson: [], contentItem: [] },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    expect(curriculumCollection).toHaveBeenCalledWith({
      courseId: course.courseId,
    });
    // Every page, not just the first: a curriculum can exceed 1 MB.
    expect(curriculumCollection.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
    expect(result).toEqual({ ...course, modules: [] });
  });

  it('nests each lesson’s content items, sorted by order', async () => {
    const module1 = {
      moduleId: 'module-1',
      courseId: course.courseId,
      title: 'First module',
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson1 = {
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      title: 'First lesson',
      kind: 'lesson' as const,
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const contentItem1 = {
      contentItemId: 'content-item-2',
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      type: 'video' as const,
      status: 'ready' as const,
      title: 'Second video',
      s3Key:
        'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-2.mp4',
      mimeType: 'video/mp4',
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const contentItem2 = {
      contentItemId: 'content-item-1',
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      type: 'video' as const,
      status: 'ready' as const,
      title: 'First video',
      s3Key:
        'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-1.mp4',
      mimeType: 'video/mp4',
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [module1].map(visible),
          lesson: [lesson1].map(visible),
          contentItem: [contentItem1, contentItem2].map(visible),
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    expect(result).toEqual({
      ...course,
      modules: [
        {
          ...module1,
          lessons: [{ ...lesson1, contentItems: [contentItem2, contentItem1] }],
        },
      ],
    });
  });

  it('shows students a video being replaced as ready, with its previous version (#209)', async () => {
    const previous =
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-1/old-nonce/master.m3u8';
    const replacing = {
      contentItemId: 'content-item-1',
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      type: 'video' as const,
      status: 'pending' as const,
      title: 'Lecture',
      s3Key:
        'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-1.mp4',
      previousS3Key: previous,
      mimeType: 'video/mp4',
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [
            {
              moduleId: 'module-1',
              courseId: course.courseId,
              title: 'Module',
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ].map(visible),
          lesson: [
            {
              lessonId: 'lesson-1',
              moduleId: 'module-1',
              courseId: course.courseId,
              title: 'Lesson',
              kind: 'lesson' as const,
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ].map(visible),
          contentItem: [replacing].map(visible),
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    const [item] = result.modules[0].lessons[0].contentItems;
    expect(item).toMatchObject({ status: 'ready', s3Key: previous });
    // Students aren't told about the replacement.
    expect(item).not.toHaveProperty('previousS3Key');
  });

  it('exposes none of a video’s caption attributes to students', async () => {
    const manifest =
      'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-1/n1/master.m3u8';
    const captioned = {
      contentItemId: 'content-item-1',
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      type: 'video' as const,
      status: 'ready' as const,
      title: 'Lecture',
      s3Key: manifest,
      mimeType: 'video/mp4',
      order: 1,
      captionTracks: [
        {
          trackId: 't1',
          nonce: 'n1',
          language: 'en-US',
          label: 'English',
          source: 'auto',
          key: 'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-1/n1/captions/t1.vtt',
          isDefault: true,
        },
      ],
      captionTracksRev: 2,
      captionsStatus: 'ready',
      captionsPendingSince: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [
            {
              moduleId: 'module-1',
              courseId: course.courseId,
              title: 'Module',
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ].map(visible),
          lesson: [
            {
              lessonId: 'lesson-1',
              moduleId: 'module-1',
              courseId: course.courseId,
              title: 'Lesson',
              kind: 'lesson' as const,
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ].map(visible),
          contentItem: [captioned].map(visible),
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    const [item] = result.modules[0].lessons[0].contentItems;
    expect(item).toMatchObject({ s3Key: manifest });
    for (const name of [
      'captionTracks',
      'captionTracksRev',
      'captionsStatus',
      'captionsPendingSince',
    ]) {
      expect(item).not.toHaveProperty(name);
    }
    expect(JSON.stringify(result)).not.toContain('captions/t1.vtt');
  });

  it('nests each module’s lessons, sorted by order', async () => {
    const module1 = {
      moduleId: 'module-2',
      courseId: course.courseId,
      title: 'Second module',
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const module2 = {
      moduleId: 'module-1',
      courseId: course.courseId,
      title: 'First module',
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson1 = {
      lessonId: 'lesson-2',
      moduleId: 'module-1',
      courseId: course.courseId,
      title: 'Second lesson',
      kind: 'lesson' as const,
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson2 = {
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      title: 'First lesson',
      kind: 'lesson' as const,
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [module1, module2].map(visible),
          lesson: [lesson1, lesson2].map(visible),
          contentItem: [],
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    expect(result).toEqual({
      ...course,
      modules: [
        {
          ...module2,
          lessons: [
            { ...lesson2, contentItems: [] },
            { ...lesson1, contentItems: [] },
          ],
        },
        { ...module1, lessons: [] },
      ],
    });
  });

  // #102: a student opening a course with an assignment used to fail output
  // validation, and the lesson's kind was stripped.
  it('serves assignment lessons: kind, due date and points, but no key', async () => {
    const stamps = {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const where = {
      courseId: course.courseId,
      moduleId: 'module-1',
    };
    const upload = {
      ...where,
      ...stamps,
      lessonId: 'lesson-upload',
      contentItemId: 'item-upload',
      type: 'assignment' as const,
      status: 'ready' as const,
      title: 'Essay',
      order: 1,
      body: '{"type":"doc"}',
      dueAt: '2026-12-01T00:00:00.000Z',
      maxPoints: 50,
      // Storage details that mustn't reach a student.
      s3Key: 'courses/secret-key',
      submissionNonce: 'nonce',
    };
    const quiz = {
      ...where,
      ...stamps,
      lessonId: 'lesson-quiz',
      contentItemId: 'item-quiz',
      type: 'quiz' as const,
      status: 'ready' as const,
      title: 'Quiz',
      order: 1,
      answerKey: [{ correct: ['a'] }],
      questions: [{ prompt: 'Q' }],
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [{ ...where, ...stamps, title: 'Module', order: 1 }].map(
            visible,
          ),
          lesson: [
            {
              ...where,
              ...stamps,
              lessonId: 'lesson-upload',
              title: 'Essay',
              kind: 'assignment' as const,
              order: 1,
            },
            {
              ...where,
              ...stamps,
              lessonId: 'lesson-quiz',
              title: 'Quiz',
              kind: 'assignment' as const,
              order: 2,
            },
          ].map(visible),
          contentItem: [upload, quiz].map(visible),
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    const [uploadLesson, quizLesson] = result.modules[0].lessons;
    expect(uploadLesson.kind).toBe('assignment');
    expect(quizLesson.kind).toBe('assignment');
    expect(uploadLesson.contentItems[0]).toMatchObject({
      type: 'assignment',
      body: '{"type":"doc"}',
      dueAt: '2026-12-01T00:00:00.000Z',
      maxPoints: 50,
    });
    expect(quizLesson.contentItems[0]).toMatchObject({ type: 'quiz' });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('secret-key');
    expect(serialised).not.toContain('nonce');
    expect(serialised).not.toContain('answerKey');
    expect(serialised).not.toContain('s3Key');
  });

  it('throws NOT_FOUND when the course does not exist', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [], module: [], lesson: [], contentItem: [] },
      }),
    });

    await expect(
      callAsUser().viewCourse({ courseId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('enrolment', () => {
    const curriculum = (status: 'draft' | 'published' | 'archived') =>
      curriculumCollection.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            course: [{ ...course, status }],
            module: [],
            lesson: [],
            contentItem: [],
          },
        }),
      });
    const notEnrolled = (data: unknown = null) =>
      enrolmentGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data }),
      });

    it('reads the caller’s own enrolment in the course', async () => {
      curriculum('published');

      await callAsUser().viewCourse({ courseId: course.courseId });

      expect(enrolmentGet).toHaveBeenCalledWith({
        courseId: course.courseId,
        userId: USER_SUB,
      });
    });

    // Invariant: only enrolled students read a course's content.
    it('is FORBIDDEN for a published course the caller isn’t enrolled in', async () => {
      curriculum('published');
      notEnrolled();

      await expect(
        callAsUser().viewCourse({ courseId: course.courseId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('treats a dropped enrolment as not enrolled', async () => {
      curriculum('published');
      notEnrolled(enrolment('dropped'));

      await expect(
        callAsUser().viewCourse({ courseId: course.courseId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    // A draft's existence isn't leaked to someone who isn't enrolled.
    it.each(['draft', 'archived'] as const)(
      'is NOT_FOUND for a %s course the caller isn’t enrolled in',
      async (status) => {
        curriculum(status);
        notEnrolled();

        await expect(
          callAsUser().viewCourse({ courseId: course.courseId }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      },
    );

    it('still shows an archived course to an enrolled student', async () => {
      curriculum('archived');

      await expect(
        callAsUser().viewCourse({ courseId: course.courseId }),
      ).resolves.toMatchObject({ status: 'archived' });
    });

    it('shows a course to a student who has completed it', async () => {
      curriculum('published');
      notEnrolled(enrolment('completed'));

      await expect(
        callAsUser().viewCourse({ courseId: course.courseId }),
      ).resolves.toMatchObject({ courseId: course.courseId });
    });
  });

  // Invariant: students never see a module, lesson or content item that is
  // hidden or archived, or that sits under a hidden or archived ancestor.
  it('omits hidden and archived records and everything under them', async () => {
    const base = {
      courseId: course.courseId,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const shownModule = {
      ...base,
      moduleId: 'module-shown',
      title: 'Shown module',
      order: 1,
    };
    const shownLesson = {
      ...base,
      moduleId: 'module-shown',
      lessonId: 'lesson-shown',
      title: 'Shown lesson',
      kind: 'lesson' as const,
      order: 1,
    };
    const shownItem = {
      ...base,
      moduleId: 'module-shown',
      lessonId: 'lesson-shown',
      contentItemId: 'item-shown',
      type: 'text' as const,
      status: 'ready' as const,
      title: 'Shown item',
      body: '{}',
      order: 1,
    };
    const textItem = (lessonId: string, contentItemId: string) => ({
      ...shownItem,
      lessonId,
      contentItemId,
      title: contentItemId,
    });
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [
            visible(shownModule),
            {
              ...shownModule,
              moduleId: 'module-hidden',
              visibility: 'hidden',
            },
            {
              ...visible(shownModule),
              moduleId: 'module-archived',
              archivedAt: '2024-02-01T00:00:00.000Z',
            },
          ],
          lesson: [
            visible(shownLesson),
            { ...shownLesson, lessonId: 'lesson-hidden', visibility: 'hidden' },
            {
              ...visible(shownLesson),
              lessonId: 'lesson-archived',
              archivedAt: '2024-02-01T00:00:00.000Z',
            },
            visible({
              ...shownLesson,
              moduleId: 'module-hidden',
              lessonId: 'lesson-under-hidden-module',
            }),
          ],
          contentItem: [
            visible(shownItem),
            {
              ...textItem('lesson-shown', 'item-hidden'),
              visibility: 'hidden',
            },
            {
              ...visible(textItem('lesson-shown', 'item-archived')),
              archivedAt: '2024-02-01T00:00:00.000Z',
            },
            visible(textItem('lesson-hidden', 'item-under-hidden-lesson')),
            visible(textItem('lesson-archived', 'item-under-archived-lesson')),
            visible(
              textItem(
                'lesson-under-hidden-module',
                'item-under-hidden-module',
              ),
            ),
          ],
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    expect(result).toEqual({
      ...course,
      modules: [
        {
          ...shownModule,
          lessons: [{ ...shownLesson, contentItems: [shownItem] }],
        },
      ],
    });
  });
  it('never returns a quiz’s questions or answer key', async () => {
    const stamps = {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const quiz = {
      ...visible({
        contentItemId: 'quiz-1',
        lessonId: 'lesson-1',
        moduleId: 'module-1',
        courseId: course.courseId,
        title: 'Check',
        order: 1,
        ...stamps,
      }),
      type: 'quiz' as const,
      status: 'ready' as const,
      questions: [{ questionId: 'q1' }],
      answerKey: { q1: { correctOptionIds: ['b'] } },
      settings: { passMarkPercent: 80 },
      quizVersion: 1,
      questionsHash: 'hash',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [course],
          module: [
            visible({
              moduleId: 'module-1',
              courseId: course.courseId,
              title: 'Module',
              order: 1,
              ...stamps,
            }),
          ],
          lesson: [
            visible({
              lessonId: 'lesson-1',
              moduleId: 'module-1',
              courseId: course.courseId,
              title: 'Lesson',
              kind: 'lesson' as const,
              order: 1,
              ...stamps,
            }),
          ],
          contentItem: [quiz],
        },
      }),
    });

    const result = await callAsUser().viewCourse({ courseId: course.courseId });

    const [item] = result.modules[0].lessons[0].contentItems;
    expect(item).toMatchObject({ contentItemId: 'quiz-1', type: 'quiz' });
    expect(JSON.stringify(result)).not.toContain('answerKey');
    expect(JSON.stringify(result)).not.toContain('correctOptionIds');
    expect(item).not.toHaveProperty('questions');
  });
});

describe('publicViewCourse', () => {
  const publishedCourse = { ...course, status: 'published' as const };
  const noExtras = { learningOutcomes: [], requirements: [], instructors: [] };

  it('allows unauthenticated callers', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [publishedCourse],
          module: [],
          lesson: [],
          contentItem: [],
        },
      }),
    });

    const result = await callAnonymously().publicViewCourse({
      courseId: publishedCourse.courseId,
    });

    expect(result).toEqual({ ...publishedCourse, ...noExtras, modules: [] });
  });

  it('throws NOT_FOUND for a draft course, without leaking that it exists', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [course], module: [], lesson: [], contentItem: [] },
      }),
    });

    await expect(
      callAnonymously().publicViewCourse({ courseId: course.courseId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when the course does not exist', async () => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [], module: [], lesson: [], contentItem: [] },
      }),
    });

    await expect(
      callAnonymously().publicViewCourse({ courseId: 'missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("nests each module's lessons, sorted by order, without content items", async () => {
    const module1 = {
      moduleId: 'module-2',
      courseId: publishedCourse.courseId,
      title: 'Second module',
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const module2 = {
      moduleId: 'module-1',
      courseId: publishedCourse.courseId,
      title: 'First module',
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson1 = {
      lessonId: 'lesson-2',
      moduleId: 'module-1',
      courseId: publishedCourse.courseId,
      title: 'Second lesson',
      kind: 'lesson' as const,
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson2 = {
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: publishedCourse.courseId,
      title: 'First lesson',
      kind: 'lesson' as const,
      order: 1,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [publishedCourse],
          module: [module1, module2].map(visible),
          lesson: [lesson1, lesson2].map(visible),
          // Content items exist but must not appear in the response.
          contentItem: [
            {
              contentItemId: 'content-item-1',
              lessonId: 'lesson-1',
              moduleId: 'module-1',
              courseId: publishedCourse.courseId,
              type: 'text' as const,
              title: 'Should not leak',
              body: 'secret',
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
    });

    const result = await callAnonymously().publicViewCourse({
      courseId: publishedCourse.courseId,
    });

    // Every page, not just the first: a curriculum can exceed 1 MB.
    expect(curriculumCollection.mock.results[0].value.go).toHaveBeenCalledWith({
      pages: 'all',
    });
    expect(result).toEqual({
      ...publishedCourse,
      ...noExtras,
      modules: [
        { ...module2, lessons: [lesson2, lesson1] },
        { ...module1, lessons: [] },
      ],
    });
  });

  it('omits hidden and archived modules and lessons, and lessons under them', async () => {
    const base = {
      courseId: publishedCourse.courseId,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const shownModule = {
      ...base,
      moduleId: 'module-shown',
      title: 'Shown module',
      order: 1,
    };
    const shownLesson = {
      ...base,
      moduleId: 'module-shown',
      lessonId: 'lesson-shown',
      title: 'Shown lesson',
      kind: 'lesson' as const,
      order: 1,
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [publishedCourse],
          module: [
            visible(shownModule),
            {
              ...shownModule,
              moduleId: 'module-hidden',
              visibility: 'hidden',
            },
            {
              ...visible(shownModule),
              moduleId: 'module-archived',
              archivedAt: '2024-02-01T00:00:00.000Z',
            },
          ],
          lesson: [
            visible(shownLesson),
            { ...shownLesson, lessonId: 'lesson-hidden', visibility: 'hidden' },
            {
              ...visible(shownLesson),
              lessonId: 'lesson-archived',
              archivedAt: '2024-02-01T00:00:00.000Z',
            },
            visible({
              ...shownLesson,
              moduleId: 'module-archived',
              lessonId: 'lesson-under-archived-module',
            }),
          ],
          contentItem: [],
        },
      }),
    });

    const result = await callAnonymously().publicViewCourse({
      courseId: publishedCourse.courseId,
    });

    expect(result).toEqual({
      ...publishedCourse,
      ...noExtras,
      modules: [{ ...shownModule, lessons: [shownLesson] }],
    });
  });

  describe('landing page fields', () => {
    const open = (course: object) =>
      curriculumCollection.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { course: [course], module: [], lesson: [], contentItem: [] },
        }),
      });
    const membership = (instructorId: string, createdAt: string) => ({
      courseId: 'course-1',
      instructorId,
      createdAt,
      courseUpdatedAt: createdAt,
    });
    const profile = (instructorId: string, handle: string) => ({
      instructorId,
      handle,
      displayName: `Name of ${handle}`,
      headline: 'A headline',
      photoKey: `instructors/${instructorId}/p.jpg`,
      version: 3,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    it('returns the outcomes, requirements and facts', async () => {
      open({
        ...publishedCourse,
        learningOutcomes: ['Build an API'],
        requirements: ['A laptop'],
        level: 'beginner',
        language: 'en',
        durationHours: 12,
      });

      const result = await callAnonymously().publicViewCourse({
        courseId: 'course-1',
      });

      expect(result).toMatchObject({
        learningOutcomes: ['Build an API'],
        requirements: ['A laptop'],
        level: 'beginner',
        language: 'en',
        durationHours: 12,
      });
    });

    it('returns empty lists when they are unset', async () => {
      open(publishedCourse);

      const result = await callAnonymously().publicViewCourse({
        courseId: 'course-1',
      });

      expect(result.learningOutcomes).toEqual([]);
      expect(result.requirements).toEqual([]);
      expect(result.category).toBeUndefined();
    });

    it('returns the category of the course when it is active', async () => {
      open({ ...publishedCourse, categoryId: 'cat-1' });
      categoryGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            categoryId: 'cat-1',
            name: 'Data science',
            slug: 'data-science',
            status: 'active',
          },
        }),
      });

      const result = await callAnonymously().publicViewCourse({
        courseId: 'course-1',
      });

      expect(result.category).toEqual({
        slug: 'data-science',
        name: 'Data science',
      });
    });

    it('leaves out an archived category', async () => {
      open({ ...publishedCourse, categoryId: 'cat-1' });
      categoryGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            categoryId: 'cat-1',
            name: 'Old',
            slug: 'old',
            status: 'archived',
          },
        }),
      });

      const result = await callAnonymously().publicViewCourse({
        courseId: 'course-1',
      });

      expect(result.category).toBeUndefined();
    });

    it('lists the instructors by when they joined, without any ID', async () => {
      open(publishedCourse);
      courseInstructorQueryPrimary.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: [
            membership('a-id', '2024-03-01T00:00:00.000Z'),
            membership('b-id', '2024-01-01T00:00:00.000Z'),
          ],
        }),
      });
      instructorProfileGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: [profile('a-id', 'alice'), profile('b-id', 'bob')],
          unprocessed: [],
        }),
      });

      const result = await callAnonymously().publicViewCourse({
        courseId: 'course-1',
      });

      expect(result.instructors).toEqual([
        {
          handle: 'bob',
          displayName: 'Name of bob',
          headline: 'A headline',
          photoKey: 'instructors/b-id/p.jpg',
        },
        {
          handle: 'alice',
          displayName: 'Name of alice',
          headline: 'A headline',
          photoKey: 'instructors/a-id/p.jpg',
        },
      ]);
      const json = JSON.stringify(result);
      expect(json).not.toContain('instructorId');
      expect(json).not.toContain('userId');
      expect(json).not.toContain('a-id"');
    });

    it('batch-gets the profiles once, not one by one', async () => {
      open(publishedCourse);
      courseInstructorQueryPrimary.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: [
            membership('a-id', '2024-03-01T00:00:00.000Z'),
            membership('b-id', '2024-01-01T00:00:00.000Z'),
          ],
        }),
      });

      await callAnonymously().publicViewCourse({ courseId: 'course-1' });

      expect(instructorProfileGet).toHaveBeenCalledTimes(1);
      expect(instructorProfileGet).toHaveBeenCalledWith([
        { instructorId: 'b-id' },
        { instructorId: 'a-id' },
      ]);
    });

    it('skips an instructor with no profile', async () => {
      open(publishedCourse);
      courseInstructorQueryPrimary.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: [
            membership('a-id', '2024-01-01T00:00:00.000Z'),
            membership('b-id', '2024-02-01T00:00:00.000Z'),
          ],
        }),
      });
      instructorProfileGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: [profile('b-id', 'bob')],
          unprocessed: [],
        }),
      });

      const result = await callAnonymously().publicViewCourse({
        courseId: 'course-1',
      });

      expect(result.instructors.map((i) => i.handle)).toEqual(['bob']);
    });

    it.each(['draft', 'archived'] as const)(
      'still answers NOT_FOUND for a %s course',
      async (status) => {
        open({ ...publishedCourse, status, learningOutcomes: ['x'] });

        await expect(
          callAnonymously().publicViewCourse({ courseId: 'course-1' }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(courseInstructorQueryPrimary).not.toHaveBeenCalled();
      },
    );
  });
});
