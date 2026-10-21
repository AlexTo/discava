/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createCourseImageUploadUrl,
  updateCourseImage,
} from './course-image.js';

const {
  courseGet,
  coursePatch,
  coursePatchSet,
  coursePatchRemove,
  coursePatchGo,
  courseInstructorGet,
  courseInstructorQueryPrimary,
  courseInstructorPatch,
  presignJpegUpload,
  headPublicMediaObject,
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
} = vi.hoisted(() => ({
  courseGet: vi.fn(),
  coursePatch: vi.fn(),
  coursePatchSet: vi.fn(),
  coursePatchRemove: vi.fn(),
  coursePatchGo: vi.fn(),
  courseInstructorGet: vi.fn(),
  courseInstructorQueryPrimary: vi.fn(),
  courseInstructorPatch: vi.fn(),
  presignJpegUpload: vi.fn(),
  headPublicMediaObject: vi.fn(),
  attachPublicMediaObject: vi.fn(),
  bestEffortDetachPublicMediaObject: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet, patch: coursePatch },
      courseInstructor: {
        get: courseInstructorGet,
        query: { primary: courseInstructorQueryPrimary },
        patch: courseInstructorPatch,
      },
    },
  })),
}));

vi.mock('../lib/public-media-client.js', () => ({
  presignJpegUpload,
  headPublicMediaObject,
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
}));

const router = t.router({ createCourseImageUploadUrl, updateCourseImage });
const caller = t.createCallerFactory(router);

const callAs = () =>
  caller({
    event: {
      requestContext: {
        authorizer: {
          claims: { sub: 'instructor-1', 'cognito:groups': ['instructor'] },
        },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const NEW_KEY =
  'courses/course-1/image/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
const OLD_KEY =
  'courses/course-1/image/7c9e6679-7425-40de-944b-e07fc1f90ae7.jpg';

const course = {
  courseId: 'course-1',
  title: 'Intro to DynamoDB',
  status: 'published' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

// What the course looked like before the write, as `response: 'all_old'`
// returns it.
let before: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  before = { ...course, imageKey: OLD_KEY };
  courseInstructorGet.mockReturnValue({
    go: async () => ({ data: { courseId: 'course-1' } }),
  });
  courseInstructorQueryPrimary.mockReturnValue({
    go: async () => ({ data: [{ instructorId: 'instructor-1' }] }),
  });
  courseInstructorPatch.mockReturnValue({
    set: () => ({ go: async () => ({}) }),
  });
  courseGet.mockReturnValue({ go: async () => ({ data: course }) });
  coursePatch.mockReturnValue({
    set: coursePatchSet,
    remove: coursePatchRemove,
  });
  coursePatchSet.mockReturnValue({ go: coursePatchGo });
  coursePatchRemove.mockReturnValue({ go: coursePatchGo });
  coursePatchGo.mockImplementation(async () => ({ data: before }));
  presignJpegUpload.mockResolvedValue({
    uploadUrl: 'https://bucket.s3/upload',
    headers: { 'Content-Type': 'image/jpeg' },
  });
  headPublicMediaObject.mockResolvedValue({
    contentType: 'image/jpeg',
    contentLength: 150_000,
  });
});

describe('course.createImageUploadUrl', () => {
  it('issues an upload for exactly the cropped image’s size, at a new key', async () => {
    const result = await callAs().createCourseImageUploadUrl({
      courseId: 'course-1',
      contentLength: 150_000,
    });

    expect(result.imageKey).toMatch(
      /^courses\/course-1\/image\/[0-9a-f-]{36}\.jpg$/,
    );
    expect(presignJpegUpload).toHaveBeenCalledWith(result.imageKey, 150_000);
    expect(result).toMatchObject({ uploadUrl: 'https://bucket.s3/upload' });
  });

  it('refuses an image over 2 MB', async () => {
    await expect(
      callAs().createCourseImageUploadUrl({
        courseId: 'course-1',
        contentLength: 2 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(presignJpegUpload).not.toHaveBeenCalled();
  });

  it('refuses an instructor not teaching the course', async () => {
    courseInstructorGet.mockReturnValue({ go: async () => ({ data: null }) });

    await expect(
      callAs().createCourseImageUploadUrl({
        courseId: 'course-1',
        contentLength: 150_000,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(presignJpegUpload).not.toHaveBeenCalled();
  });

  it('refuses while the course is archived', async () => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { ...course, status: 'archived' } }),
    });

    await expect(
      callAs().createCourseImageUploadUrl({
        courseId: 'course-1',
        contentLength: 150_000,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('course.updateImage', () => {
  it('keeps the new image, saves it, and lets the one it replaced expire', async () => {
    await callAs().updateCourseImage({
      courseId: 'course-1',
      imageKey: NEW_KEY,
    });

    expect(attachPublicMediaObject).toHaveBeenCalledWith(NEW_KEY);
    expect(coursePatchSet).toHaveBeenCalledWith({ imageKey: NEW_KEY });
    expect(coursePatchGo).toHaveBeenCalledWith({ response: 'all_old' });
    // Kept before it's saved, so a saved image is never about to expire.
    expect(attachPublicMediaObject.mock.invocationCallOrder[0]).toBeLessThan(
      coursePatchGo.mock.invocationCallOrder[0],
    );
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      OLD_KEY,
    );
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledTimes(1);
  });

  it('removes the image, letting it expire', async () => {
    await callAs().updateCourseImage({ courseId: 'course-1', imageKey: null });

    expect(coursePatchRemove).toHaveBeenCalledWith(['imageKey']);
    expect(attachPublicMediaObject).not.toHaveBeenCalled();
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      OLD_KEY,
    );
  });

  it('leaves the image alone when it’s saved again', async () => {
    before = { ...course, imageKey: NEW_KEY };

    await callAs().updateCourseImage({
      courseId: 'course-1',
      imageKey: NEW_KEY,
    });

    expect(bestEffortDetachPublicMediaObject).not.toHaveBeenCalled();
  });

  it.each([
    ['another course’s image', OLD_KEY.replace('course-1', 'course-2')],
    ['a key it didn’t issue', 'courses/course-1/image/anything.jpg'],
  ])('refuses %s', async (_, imageKey) => {
    await expect(
      callAs().updateCourseImage({ courseId: 'course-1', imageKey }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(attachPublicMediaObject).not.toHaveBeenCalled();
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it.each([
    ['never uploaded', undefined],
    ['not a JPEG', { contentType: 'image/png', contentLength: 150_000 }],
    ['over 2 MB', { contentType: 'image/jpeg', contentLength: 3_000_000 }],
  ])('refuses an image %s', async (_, upload) => {
    headPublicMediaObject.mockResolvedValue(upload);

    await expect(
      callAs().updateCourseImage({ courseId: 'course-1', imageKey: NEW_KEY }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(coursePatch).not.toHaveBeenCalled();
  });

  it('lets the new image expire again if saving it fails', async () => {
    coursePatchGo.mockRejectedValue(new Error('DynamoDB is unavailable'));

    await expect(
      callAs().updateCourseImage({ courseId: 'course-1', imageKey: NEW_KEY }),
    ).rejects.toThrow();
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      NEW_KEY,
    );
    expect(bestEffortDetachPublicMediaObject).not.toHaveBeenCalledWith(
      expect.anything(),
      OLD_KEY,
    );
  });

  it('refuses while the course is archived', async () => {
    courseGet.mockReturnValue({
      go: async () => ({ data: { ...course, status: 'archived' } }),
    });

    await expect(
      callAs().updateCourseImage({ courseId: 'course-1', imageKey: NEW_KEY }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(coursePatch).not.toHaveBeenCalled();
  });
});
