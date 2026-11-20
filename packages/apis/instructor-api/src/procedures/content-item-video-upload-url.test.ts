/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  CONTENT_ITEM_ID,
  COURSE_ID,
  contentItem,
  contentItemGet,
  courseGet,
  courseInstructorGet,
  INSTRUCTOR_SUB,
  installDefaults,
  LESSON_ID,
  lesson,
  lessonGet,
  MODULE_ID,
  moduleGet,
  OBJECT_KEY_PREFIX,
  textContentItem,
} from './content-item-video.fixtures.js';
import {
  createContentItemVideoUploadUrl,
  updateContentItemVideo,
} from './content-item-video.js';

const {
  mockModule,
  getSignedUrl,
  s3Send,
  resolveLessonMediaUploadBucketName,
  bestEffortDeleteContentItemVideos,
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  getVideoUploadETag,
} = await vi.hoisted(
  async () => (await import('./content-item-video.fixtures.js')).spies,
);

vi.mock('@discava/core-table', async (importOriginal) =>
  mockModule(await importOriginal()),
);

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(function (input) {
    return input;
  }),
  DeleteObjectCommand: vi.fn(function (input) {
    return input;
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl,
}));

// bestEffortDeleteContentItemVideos's own error-swallowing/bucket-selection
// behavior is covered directly in helpers/s3-client.test.ts; here it's just a
// mock so these tests can assert content-item-video.ts calls it correctly.
vi.mock('@discava/common-server-utils/lesson-media-bucket', () => ({
  getS3Client: () => ({ send: s3Send }),
  resolveLessonMediaUploadBucketName,
}));

vi.mock('../helpers/s3-client.js', () => ({
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions: vi.fn(async () => {}),
  getVideoUploadETag,
}));

// getSignedCloudFrontCookies/getCloudFrontVideoUrl's own config-resolution/
// signing behavior is covered directly in @discava/common-server-utils's lesson-media.test.ts;
// here they're just mocks so these tests can assert createContentItemVideoUrl
// calls them correctly.
vi.mock('@discava/common-server-utils/lesson-media', () => ({
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
}));

// submitTranscodeJob's own MediaConvert-request-shape behavior is covered
// directly in helpers/mediaconvert-client.test.ts; here it's just a mock so
// these tests can assert create/updateContentItemVideo call it correctly.
vi.mock('../helpers/mediaconvert-client.js', () => ({
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({
  createContentItemVideoUploadUrl,
  updateContentItemVideo,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: INSTRUCTOR_SUB, groups });

beforeEach(installDefaults);

describe('createContentItemVideoUploadUrl', () => {
  // Invariant: nothing can be uploaded for an archived lesson or an archived
  // content item, so no upload is left behind that the create/update
  // procedures would then reject.
  it('refuses an assignment lesson without minting an upload URL (#102)', async () => {
    lessonGet.mockReturnValue({
      go: vi
        .fn()
        .mockResolvedValue({ data: { ...lesson, kind: 'assignment' } }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('refuses an archived lesson without minting an upload URL', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson before adding content to it',
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  // An archived course is read-only: no upload is left behind in it either.
  it('refuses an archived course without minting an upload URL', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'archived' } }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a lesson under an archived module without minting an upload URL', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the module first',
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses to replace the file of an archived content item without minting an upload URL', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...contentItem, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
        contentItemId: CONTENT_ITEM_ID,
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the content item before editing it',
    });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the caller does not teach the course', async () => {
    courseInstructorGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(lessonGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: 'missing-lesson',
        fileName: 'intro.mp4',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST for a disallowed file extension', async () => {
    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.exe',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns a presigned upload URL scoped to the lesson', async () => {
    const result = await callAs().createContentItemVideoUploadUrl({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      fileName: 'intro.mp4',
    });

    expect(result.objectKey.startsWith(OBJECT_KEY_PREFIX)).toBe(true);
    expect(result.objectKey.endsWith('.mp4')).toBe(true);
    expect(result.uploadUrl).toBe('https://example.com/signed-url');
    expect(result.contentItemId).toBeTruthy();
  });

  // Invariant: a replacement upload reuses the existing content item's id
  // in the key rather than minting an unrelated one, so the key's id
  // segment always names a real content item.
  it('reuses the given contentItemId in the object key when replacing an existing video', async () => {
    const result = await callAs().createContentItemVideoUploadUrl({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      fileName: 'intro.webm',
      contentItemId: CONTENT_ITEM_ID,
    });

    expect(contentItemGet).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
    expect(result.contentItemId).toBe(CONTENT_ITEM_ID);
    expect(
      result.objectKey.startsWith(`${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/`),
    ).toBe(true);
    expect(result.objectKey.endsWith('.webm')).toBe(true);
  });

  // Invariant: two uploads for the same content item (e.g. successive
  // replacements) must never land at the same S3 key -- DynamoDB's own
  // conditions can't protect a plain S3 object from a second, unrelated
  // write to the same path (see updateContentItemVideo's nonce-conditioned
  // patches), so uniqueness has to come from the key itself.
  it('mints a different object key for each upload, even for the same content item', async () => {
    const first = await callAs().createContentItemVideoUploadUrl({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      fileName: 'intro.mp4',
      contentItemId: CONTENT_ITEM_ID,
    });
    const second = await callAs().createContentItemVideoUploadUrl({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      fileName: 'intro.mp4',
      contentItemId: CONTENT_ITEM_ID,
    });

    expect(first.objectKey).not.toBe(second.objectKey);
  });

  it('throws NOT_FOUND when the given contentItemId does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
        contentItemId: 'missing-content-item',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the given contentItemId is not a video', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: textContentItem }),
    });

    await expect(
      callAs().createContentItemVideoUploadUrl({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        fileName: 'intro.mp4',
        contentItemId: CONTENT_ITEM_ID,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
