/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  course,
  enrolment,
  installDefaults,
  USER_SUB,
  visible,
} from './course.fixtures.js';
import { viewCourse } from './course.js';

const {
  categoryGet,
  courseGet,
  courseInstructorQueryByInstructor,
  courseInstructorQueryPrimary,
  coursePreviewGet,
  courseQueryByStatus,
  courseRatingGet,
  curriculumCollection,
  enrolmentGet,
  getSignedCloudFrontCookies,
  instructorProfileGet,
  userGet,
} = await vi.hoisted(async () => (await import('./course.fixtures.js')).spies);

vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getCloudFrontVideoUrl: vi.fn(
    async (key: string) => `https://media.example.com/${key}`,
  ),
  getSignedCloudFrontCookies,
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
      coursePreview: { get: coursePreviewGet },
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
  viewCourse,
});

const callAsUser = () => callerFor(router, { sub: USER_SUB });

const callAnonymously = () => callerFor(router);

beforeEach(installDefaults);

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
