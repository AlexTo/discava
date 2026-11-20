/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { course, installDefaults, visible } from './course.fixtures.js';
import { publicViewCourse } from './course.js';

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
  publicViewCourse,
});

const callAnonymously = () => callerFor(router);

beforeEach(installDefaults);

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

  it('returns none of a video’s questions, answer key or quiz version', async () => {
    const withQuestions = {
      contentItemId: 'content-item-1',
      lessonId: 'lesson-1',
      moduleId: 'module-1',
      courseId: publishedCourse.courseId,
      type: 'video' as const,
      status: 'ready' as const,
      title: 'Lecture',
      s3Key:
        'courses/course-1/modules/module-1/lessons/lesson-1/content-items/content-item-1/n1/master.m3u8',
      mimeType: 'video/mp4',
      order: 1,
      questions: [
        {
          questionId: 'q1',
          kind: 'single',
          prompt: 'SECRET-PROMPT',
          options: [
            { optionId: 'a', text: 'Yes' },
            { optionId: 'b', text: 'No' },
          ],
          atSeconds: 5,
          contentHash: 'hash',
        },
      ],
      answerKey: { q1: { correctOptionIds: ['a'] } },
      quizVersion: 2,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: {
          course: [publishedCourse],
          module: [
            visible({
              moduleId: 'module-1',
              courseId: publishedCourse.courseId,
              title: 'Module',
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }),
          ],
          lesson: [
            visible({
              lessonId: 'lesson-1',
              moduleId: 'module-1',
              courseId: publishedCourse.courseId,
              title: 'Lesson',
              kind: 'lesson' as const,
              order: 1,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }),
          ],
          contentItem: [visible(withQuestions)],
        },
      }),
    });

    const result = await callAnonymously().publicViewCourse({
      courseId: publishedCourse.courseId,
    });

    expect(JSON.stringify(result)).not.toMatch(
      /SECRET-PROMPT|answerKey|quizVersion|contentHash/,
    );
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

describe('publicViewCourse preview', () => {
  const published = { ...course, status: 'published' as const };
  const readyPreview = {
    courseId: 'course-1',
    status: 'ready' as const,
    s3Key: 'courses/course-1/preview/nonce-2/master.m3u8',
    previousS3Key: 'courses/course-1/preview/nonce-1/master.m3u8',
    submissionNonce: 'nonce-2',
    mediaConvertJobId: 'job-1',
    durationSeconds: 90,
    uploadedBy: 'instructor-1',
  };

  const view = async (preview: unknown) => {
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [published], module: [], lesson: [], contentItem: [] },
      }),
    });
    coursePreviewGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: preview }),
    });
    return callAnonymously().publicViewCourse({ courseId: 'course-1' });
  };

  it('has only the duration, never keys, nonces or uploadedBy', async () => {
    const result = await view(readyPreview);

    expect(result.preview).toEqual({ durationSeconds: 90 });
    expect(JSON.stringify(result)).not.toMatch(
      /nonce|master\.m3u8|job-1|uploadedBy|instructor-1/,
    );
  });

  it('has a preview when a replacement processes over a playable version', async () => {
    const result = await view({
      ...readyPreview,
      status: 'processing',
      s3Key: undefined,
    });

    expect(result.preview).toEqual({ durationSeconds: 90 });
  });

  it.each([
    ['no preview', null],
    [
      'a first upload processing',
      {
        ...readyPreview,
        status: 'processing',
        s3Key: undefined,
        previousS3Key: undefined,
      },
    ],
    [
      'a failed first upload',
      {
        ...readyPreview,
        status: 'failed',
        s3Key: undefined,
        previousS3Key: undefined,
      },
    ],
  ])('has no preview for %s', async (_name, preview) => {
    expect((await view(preview)).preview).toBeUndefined();
  });
});
