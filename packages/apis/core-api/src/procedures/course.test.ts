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
  curriculumCollection,
} = vi.hoisted(() => ({
  courseInstructorQueryByInstructor: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseQueryByStatus: vi.fn(),
  courseGet: vi.fn(),
  userGet: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(result).toEqual({ items: [course], cursor: null });
  });

  it('queries only published courses, defaulting limit to 10', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [], cursor: null }),
    });

    await callAnonymously().publicListCourses({});

    expect(courseQueryByStatus).toHaveBeenCalledWith({ status: 'published' });
    expect(courseQueryByStatus.mock.results[0].value.go).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 10,
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
    });
    expect(result).toEqual({ items: [course], cursor: 'next-page' });
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
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson2 = {
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: course.courseId,
      title: 'First lesson',
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

    expect(result).toEqual({ ...publishedCourse, modules: [] });
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
      order: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const lesson2 = {
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: publishedCourse.courseId,
      title: 'First lesson',
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
      modules: [{ ...shownModule, lessons: [shownLesson] }],
    });
  });
});
