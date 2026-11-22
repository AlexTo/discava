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
} from './course.fixtures.js';
import {
  listCoursesByInstructor,
  listInstructorsForCourse,
  previewVideoUrl,
  publicListCourses,
  publicViewCourse,
  viewCourse,
} from './course.js';

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
  listCoursesByInstructor,
  listInstructorsForCourse,
  previewVideoUrl,
  publicListCourses,
  publicViewCourse,
  viewCourse,
});

const callAsUser = () => callerFor(router, { sub: USER_SUB });

const callAnonymously = () => callerFor(router);

beforeEach(installDefaults);

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

describe('previewVideoUrl', () => {
  const published = { ...course, status: 'published' as const };
  const FOLDER = 'courses/course-1/preview/nonce-2/';
  const readyPreview = {
    courseId: 'course-1',
    status: 'ready' as const,
    s3Key: `${FOLDER}master.m3u8`,
    submissionNonce: 'nonce-2',
    durationSeconds: 90,
    uploadedBy: 'instructor-1',
    captionTracks: [
      {
        trackId: 't1',
        language: 'en-US',
        label: 'English',
        isDefault: true,
        source: 'auto',
        key: `${FOLDER}captions/t1.vtt`,
        nonce: 'nonce-2',
      },
    ],
  };

  const given = (courseRecord: unknown, preview: unknown) => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: courseRecord }),
    });
    coursePreviewGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: preview }),
    });
  };

  const callPublicly = (responseCookies: string[] = []) =>
    callerFor(router, { responseCookies });

  it('plays a ready preview for an anonymous visitor, with captions', async () => {
    given(published, readyPreview);
    const cookies: string[] = [];

    const result = await callPublicly(cookies).previewVideoUrl({
      courseId: 'course-1',
    });

    expect(result).toMatchObject({
      url: `https://media.example.com/${FOLDER}master.m3u8`,
      withCredentials: true,
      versionId: 'nonce-2',
      captions: [
        {
          trackId: 't1',
          language: 'en-US',
          isDefault: true,
          url: `https://media.example.com/${FOLDER}captions/t1.vtt`,
        },
      ],
    });
    expect(result).not.toHaveProperty('resumeAt');
    expect(cookies).toEqual(['CloudFront-Policy=abc']);
  });

  it('returns translated tracks to an anonymous visitor, flagged as machine-translated', async () => {
    given(published, {
      ...readyPreview,
      captionTracks: [
        ...readyPreview.captionTracks,
        {
          trackId: 't2',
          language: 'es-ES',
          label: 'Español',
          isDefault: false,
          source: 'translated',
          key: `${FOLDER}captions/t2.vtt`,
          nonce: 'nonce-2',
        },
      ],
    });

    const { captions } = await callPublicly().previewVideoUrl({
      courseId: 'course-1',
    });

    expect(captions.map((c) => [c.trackId, c.machineTranslated])).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
  });

  it('scopes the cookies to the played version folder only', async () => {
    given(published, readyPreview);

    await callPublicly([]).previewVideoUrl({ courseId: 'course-1' });

    expect(getSignedCloudFrontCookies).toHaveBeenCalledExactlyOnceWith(FOLDER);
  });

  it('plays the previous version while a replacement processes', async () => {
    given(published, {
      ...readyPreview,
      status: 'processing',
      s3Key: undefined,
      previousS3Key: 'courses/course-1/preview/nonce-1/master.m3u8',
      captionTracks: [],
    });

    const result = await callPublicly().previewVideoUrl({
      courseId: 'course-1',
    });

    expect(result.url).toBe(
      'https://media.example.com/courses/course-1/preview/nonce-1/master.m3u8',
    );
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(
      'courses/course-1/preview/nonce-1/',
    );
  });

  it.each([
    ['there is no preview', published, null],
    [
      'a first upload is processing',
      published,
      { ...readyPreview, status: 'processing', s3Key: undefined },
    ],
    [
      'a first upload failed',
      published,
      { ...readyPreview, status: 'failed', s3Key: undefined },
    ],
    ['the course is a draft', course, readyPreview],
    ['the course is archived', { ...course, status: 'archived' }, readyPreview],
    ['the course does not exist', null, readyPreview],
  ])('is NOT_FOUND when %s', async (_name, courseRecord, preview) => {
    given(courseRecord, preview);

    await expect(
      callPublicly().previewVideoUrl({ courseId: 'course-1' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'This preview is not available',
    });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });
});

describe('course prices in outputs', () => {
  // What the table holds beyond what an output may show.
  const priced = {
    ...course,
    status: 'published' as const,
    priceAmount: 1999,
    priceCurrency: 'EUR',
    pricedAt: '2024-02-01T00:00:00.000Z',
    orderId: 'order-1',
  };
  const curriculum = () =>
    curriculumCollection.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { course: [priced], module: [], lesson: [], contentItem: [] },
      }),
    });

  it('returns the price, and nothing of its history, from publicListCourses', async () => {
    courseQueryByStatus.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: [priced], cursor: null }),
    });

    const { items } = await callAnonymously().publicListCourses({});

    expect(items[0]).toMatchObject({ priceAmount: 1999, priceCurrency: 'EUR' });
    expect(items[0]).not.toHaveProperty('pricedAt');
    expect(items[0]).not.toHaveProperty('orderId');
  });

  it('returns the price, and nothing of its history, from publicViewCourse', async () => {
    curriculum();

    const result = await callAnonymously().publicViewCourse({
      courseId: priced.courseId,
    });

    expect(result).toMatchObject({ priceAmount: 1999, priceCurrency: 'EUR' });
    expect(result).not.toHaveProperty('pricedAt');
    expect(result).not.toHaveProperty('orderId');
  });

  it('returns the price, and nothing of its history, from viewCourse', async () => {
    curriculum();
    enrolmentGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: enrolment() }),
    });

    const result = await callAsUser().viewCourse({ courseId: priced.courseId });

    expect(result).toMatchObject({ priceAmount: 1999, priceCurrency: 'EUR' });
    expect(result).not.toHaveProperty('pricedAt');
    expect(result).not.toHaveProperty('orderId');
  });
});
