/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { bestEffortRetirePreviousVersions } from '../lib/s3-client.js';
import {
  createContentItemVideo,
  createContentItemVideoUploadUrl,
  createContentItemVideoUrl,
  updateContentItemVideo,
} from './content-item-video.js';

const {
  moduleGet,
  courseGet,
  courseInstructorGet,
  lessonGet,
  contentItemQueryPrimary,
  contentItemCreate,
  contentItemGet,
  contentItemPatch,
  contentItemPatchSet,
  contentItemPatchRemove,
  contentItemPatchWhere,
  contentItemDelete,
  courseCheck,
  moduleCheck,
  lessonCheck,
  transactionWrite,
  s3Send,
  getSignedUrl,
  resolveLessonMediaUploadBucketName,
  bestEffortDeleteContentItemVideos,
  getSignedCloudFrontCookies,
  getCloudFrontVideoUrl,
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  getVideoUploadETag,
} = vi.hoisted(() => ({
  moduleGet: vi.fn(),
  courseGet: vi.fn(),
  courseInstructorGet: vi.fn(),
  lessonGet: vi.fn(),
  contentItemQueryPrimary: vi.fn(),
  contentItemCreate: vi.fn(),
  contentItemGet: vi.fn(),
  contentItemPatch: vi.fn(),
  contentItemPatchSet: vi.fn(),
  contentItemPatchRemove: vi.fn(),
  contentItemPatchWhere: vi.fn(),
  contentItemDelete: vi.fn(),
  courseCheck: vi.fn(),
  moduleCheck: vi.fn(),
  lessonCheck: vi.fn(),
  transactionWrite: vi.fn(),
  s3Send: vi.fn(),
  getSignedUrl: vi.fn(),
  resolveLessonMediaUploadBucketName: vi.fn(),
  bestEffortDeleteContentItemVideos: vi.fn(),
  getSignedCloudFrontCookies: vi.fn(),
  getCloudFrontVideoUrl: vi.fn(),
  submitTranscodeJob: vi.fn(),
  bestEffortCancelTranscodeJob: vi.fn(),
  bestEffortCancelTranscodeJobs: vi.fn(),
  getVideoUploadETag: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: {
      course: { get: courseGet },
      courseInstructor: {
        get: courseInstructorGet,
      },
      module: {
        get: moduleGet,
      },
      lesson: {
        get: lessonGet,
      },
      contentItem: {
        query: {
          primary: contentItemQueryPrimary,
        },
        create: contentItemCreate,
        get: contentItemGet,
        patch: contentItemPatch,
        delete: contentItemDelete,
      },
    },
    transaction: { write: transactionWrite },
  })),
}));

// Plain function expressions, not arrow functions: these are constructed
// with `new` in content-item-video.ts, and arrow functions can never be
// constructors.
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
// behavior is covered directly in lib/s3-client.test.ts; here it's just a
// mock so these tests can assert content-item-video.ts calls it correctly.
vi.mock('../lib/s3-client.js', () => ({
  getS3Client: () => ({ send: s3Send }),
  resolveLessonMediaUploadBucketName,
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
// directly in lib/mediaconvert-client.test.ts; here it's just a mock so
// these tests can assert create/updateContentItemVideo call it correctly.
vi.mock('../lib/mediaconvert-client.js', () => ({
  submitTranscodeJob,
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
}));

const router = t.router({
  createContentItemVideoUploadUrl,
  createContentItemVideo,
  updateContentItemVideo,
  createContentItemVideoUrl,
});
const caller = t.createCallerFactory(router);

const INSTRUCTOR_SUB = 'instructor-1';
const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';
const CONTENT_ITEM_ID = 'content-item-1';
const BUCKET_NAME = 'lesson-media-bucket';
const OBJECT_ETAG = '"etag-1"';

// Matches the shape isConditionalCheckFailed checks for -- an ElectroError
// wrapping the underlying AWS SDK exception, the same shape observed from
// a real DynamoDB conditional write rejection.
const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

// Gives a mocked ElectroDB chain the `.commit()` a transaction item needs,
// at every step of the chain. Committing defers to that step's own `.go()`,
// which the fake transaction below runs, so a test drives a transactional
// write's outcome the same way as a direct one: by what its `.go()` does.
const committable = (chain: any): any => {
  if (chain === null || typeof chain !== 'object') {
    return chain;
  }
  return new Proxy(chain, {
    get(target, prop) {
      if (prop === 'commit') {
        return () => ({ run: () => target.go() });
      }
      const value = target[prop];
      return typeof value === 'function' && prop !== 'go'
        ? (...args: unknown[]) => committable(value.apply(target, args))
        : value;
    },
  });
};

// The entities a `coreTable.transaction.write` builder receives. Writes go
// through the same mocks as direct writes, so assertions on contentItemPatch/
// contentItemPatchSet/contentItemPatchWhere/etc hold either way.
const transactionEntities = {
  course: { check: (key: unknown) => committable(courseCheck(key)) },
  module: { check: (key: unknown) => committable(moduleCheck(key)) },
  lesson: { check: (key: unknown) => committable(lessonCheck(key)) },
  contentItem: {
    create: (item: unknown) => committable(contentItemCreate(item)),
    patch: (key: unknown) => committable(contentItemPatch(key)),
  },
};

const isConditionalCheckFailedError = (error: unknown) =>
  error instanceof Error &&
  error.cause instanceof Error &&
  error.cause.name === 'ConditionalCheckFailedException';

// Runs the transaction's items in order (ancestor checks first, as built).
// An item whose `.go()` fails its condition cancels the transaction, reported
// the way DynamoDB does: a per-item result with that item's code. Any other
// failure rejects the transaction itself, like a transient DynamoDB error.
const fakeTransactionWrite = (
  build: (entities: typeof transactionEntities) => { run: () => unknown }[],
) => {
  const items = build(transactionEntities);
  return {
    go: async () => {
      const data: { code: string }[] = [];
      for (const item of items) {
        try {
          await item.run();
          data.push({ code: 'None' });
        } catch (error) {
          if (!isConditionalCheckFailedError(error)) {
            throw error;
          }
          data.push({ code: 'ConditionalCheckFailed' });
          return { canceled: true, data };
        }
      }
      return { canceled: false, data: [] };
    },
  };
};

const buildEvent = (groups: string[]): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: INSTRUCTOR_SUB, 'cognito:groups': groups } },
    },
  }) as unknown as APIGatewayProxyEvent;

const callAs = (groups: string[] = ['instructor']) =>
  caller({ event: buildEvent(groups), context: {} as any, info: {} as any });

const lesson = {
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  title: 'Welcome',
  order: 1,
  visibility: 'visible' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const OBJECT_KEY_PREFIX = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/`;

const contentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'video' as const,
  status: 'ready' as const,
  title: 'Intro video',
  s3Key: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}.mp4`,
  mimeType: 'video/mp4',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const textBody = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

const textContentItem = {
  contentItemId: CONTENT_ITEM_ID,
  lessonId: LESSON_ID,
  moduleId: MODULE_ID,
  courseId: COURSE_ID,
  type: 'text' as const,
  status: 'ready' as const,
  title: 'Welcome notes',
  body: textBody,
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();

  courseGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: { status: 'draft' } }),
  });

  courseInstructorGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { courseId: COURSE_ID, instructorId: INSTRUCTOR_SUB },
    }),
  });
  // The module above the lesson; not archived unless a test says so.
  moduleGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({
      data: { moduleId: MODULE_ID, visibility: 'visible' },
    }),
  });
  lessonGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: lesson }),
  });
  contentItemQueryPrimary.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: [] }),
  });
  contentItemCreate.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
  });
  contentItemGet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
  });
  contentItemPatch.mockReturnValue({ set: contentItemPatchSet });
  contentItemPatchSet.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
    where: contentItemPatchWhere,
    remove: contentItemPatchRemove,
  });
  contentItemPatchRemove.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
    where: contentItemPatchWhere,
  });
  contentItemPatchWhere.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
  });
  contentItemDelete.mockReturnValue({
    go: vi.fn().mockResolvedValue({ data: contentItem }),
    where: () => ({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    }),
  });
  // The course, module and lesson are still there and not archived when the
  // transaction lands, unless a test says otherwise.
  courseCheck.mockReturnValue({
    where: () => ({ go: vi.fn().mockResolvedValue({}) }),
  });
  moduleCheck.mockReturnValue({
    where: () => ({ go: vi.fn().mockResolvedValue({}) }),
  });
  lessonCheck.mockReturnValue({
    where: () => ({ go: vi.fn().mockResolvedValue({}) }),
  });
  transactionWrite.mockImplementation(fakeTransactionWrite);
  s3Send.mockResolvedValue({});
  getSignedUrl.mockResolvedValue('https://example.com/signed-url');
  resolveLessonMediaUploadBucketName.mockResolvedValue(BUCKET_NAME);
  bestEffortDeleteContentItemVideos.mockResolvedValue(undefined);
  getSignedCloudFrontCookies.mockResolvedValue([
    'CloudFront-Policy=fake; Domain=example.com',
  ]);
  getCloudFrontVideoUrl.mockResolvedValue(
    'https://example.cloudfront.net/plain-url',
  );
  submitTranscodeJob.mockResolvedValue('job-1');
  bestEffortCancelTranscodeJob.mockResolvedValue(undefined);
  bestEffortCancelTranscodeJobs.mockResolvedValue(undefined);
  getVideoUploadETag.mockResolvedValue(OBJECT_ETAG);
});

describe('createContentItemVideoUploadUrl', () => {
  // Invariant: nothing can be uploaded for an archived lesson or an archived
  // content item, so no upload is left behind that the create/update
  // procedures would then reject.
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

  // Invariant: a replacement upload must reuse the existing content item's
  // real id in the key instead of minting an unrelated one -- the id
  // segment is what createContentItemVideo/updateContentItemVideo validate
  // the key against, and a mismatch there means a replacement can never be
  // recorded against the right content item.
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

describe('createContentItemVideo', () => {
  const validInput = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
    title: 'Intro video',
    objectKey: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}.mp4`,
    mimeType: 'video/mp4',
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the lesson does not exist', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the objectKey does not match the lesson and content item', async () => {
    await expect(
      callAs().createContentItemVideo({
        ...validInput,
        objectKey: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/other-lesson/content-items/some-id.mp4`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the objectKey does not point to an uploaded file', async () => {
    getVideoUploadETag.mockResolvedValue(undefined);

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  // Invariant: same as every other new record -- visible straight away in a
  // draft course, hidden until published in a published one. (An archived
  // course is read-only: see below.)
  it.each([
    ['draft', 'visible'],
    ['published', 'hidden'],
  ] as const)(
    'in a %s course, creates the video record as %s',
    async (status, visibility) => {
      courseGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: { status } }),
      });

      await callAs().createContentItemVideo(validInput);

      expect(contentItemCreate).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      );
    },
  );

  // An archived course is read-only: nothing is created in it, and no
  // transcode is submitted.
  it('refuses to create a video in an archived course', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'archived' } }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(contentItemCreate).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the course does not exist', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: null }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  // The record is created in one transaction with checks on the module and
  // lesson, so a module archived after the procedure's own checks cancels
  // the create -- and no transcode is ever submitted for it.
  it('refuses, without submitting a transcode, when the module is archived in the meantime', async () => {
    moduleGet
      .mockReturnValueOnce({
        go: vi.fn().mockResolvedValue({
          data: { moduleId: MODULE_ID, visibility: 'visible' },
        }),
      })
      .mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
        }),
      });
    moduleCheck.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the module first',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('refuses to add a video under an archived module, before checking the upload', async () => {
    moduleGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { moduleId: MODULE_ID, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the module first',
    });
    expect(getVideoUploadETag).not.toHaveBeenCalled();
    expect(contentItemCreate).not.toHaveBeenCalled();
  });

  it('refuses to add a video to an archived lesson, before checking the upload', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().createContentItemVideo(validInput),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(getVideoUploadETag).not.toHaveBeenCalled();
    expect(contentItemCreate).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  it('starts at order 1 and sets status pending for the first content item in a lesson', async () => {
    await callAs().createContentItemVideo(validInput);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'video',
        status: 'pending',
        order: 1,
        // Watched by the transcode reconciler until ready or failed (#125).
        transcodePending: 'pending',
        transcodePendingSince: expect.any(String),
      }),
    );
  });

  // Invariant: the transcode job must only be submitted once the record
  // exists, so its completion callback can never race the DynamoDB write
  // it needs to patch.
  it('submits the transcode job only after the content item record is created', async () => {
    const callOrder: string[] = [];
    contentItemCreate.mockReturnValue({
      go: vi.fn().mockImplementation(async () => {
        callOrder.push('create');
        return { data: contentItem };
      }),
    });
    submitTranscodeJob.mockImplementation(async () => {
      callOrder.push('submitTranscodeJob');
      return 'job-1';
    });
    contentItemPatchSet.mockReturnValue({
      where: () => ({
        go: vi.fn().mockImplementation(async () => {
          callOrder.push('patchJobId');
          return { data: contentItem };
        }),
      }),
    });

    await callAs().createContentItemVideo(validInput);

    expect(submitTranscodeJob).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: validInput.objectKey,
      submissionNonce: expect.any(String),
    });
    expect(callOrder).toEqual(['create', 'submitTranscodeJob', 'patchJobId']);
  });

  // The nonce is what submitTranscodeJob's ClientRequestToken is derived
  // from -- it has to be the exact same value the record itself is
  // stamped with, or a crashed retry could never reconnect to this job.
  it('stamps the record with the same nonce passed to submitTranscodeJob', async () => {
    await callAs().createContentItemVideo(validInput);

    const [createArgs] = contentItemCreate.mock.calls[0]!;
    const [submitArgs] = submitTranscodeJob.mock.calls[0]!;
    expect(createArgs.submissionNonce).toBeTruthy();
    expect(createArgs.submissionNonce).toBe(submitArgs.submissionNonce);
  });

  it('stamps the submitted job id onto the record so a later replacement can be told apart', async () => {
    await callAs().createContentItemVideo(validInput);

    expect(contentItemPatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
    expect(contentItemPatchSet).toHaveBeenCalledWith({
      mediaConvertJobId: 'job-1',
      rawObjectETag: OBJECT_ETAG,
    });
  });

  // Invariant: a failed submission must never leave a permanently broken
  // 'pending' record with no job behind it -- the record didn't exist
  // before this call, so rolling back means deleting it, letting a retry
  // (even with the exact same input) start clean.
  it('deletes the newly created record when transcode submission fails', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow(
      'MediaConvert is unavailable',
    );

    expect(contentItemDelete).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
  });

  it('still surfaces the original submission error even if the rollback delete itself fails', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    contentItemDelete.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
      }),
    });

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow(
      'MediaConvert is unavailable',
    );
  });

  it('does not stamp a job id when submission fails', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow();

    expect(contentItemPatchSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ mediaConvertJobId: expect.anything() }),
    );
  });

  // Invariant: CreateJob succeeding means a real, billable job now exists
  // regardless of whether this stamp lands -- rolling back (deleting the
  // record) here would orphan it, since the completion event would then
  // find no record to patch. submissionNonce is already durable from the
  // .create() above, so a later retry's crash-gap check reconnects to
  // this exact job instead.
  it('does not delete the record when only the job-id stamp fails after a successful submission', async () => {
    contentItemPatchSet.mockReturnValueOnce({
      where: () => ({
        go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
      }),
    });

    const result = await callAs().createContentItemVideo(validInput);

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: a concurrent updateContentItemVideo call could have already
  // read this just-created record and replaced it with its own submission
  // before this stamp lands -- losing the conditional write here means
  // this attempt's own job has nothing left pointing at it, since the
  // record has moved on to a different nonce/job entirely. Nothing else
  // will ever cancel or clean up that orphaned job, so this attempt has to.
  it('cancels its own job when the stamp loses ownership to a newer replacement', async () => {
    contentItemPatchSet.mockReturnValueOnce({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    const result = await callAs().createContentItemVideo(validInput);

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemDelete).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: 'job-1',
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
      }),
    );
  });

  it('conditions the rollback delete on this attempt owning the record', async () => {
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    const deleteWhere = vi.fn().mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    });
    contentItemDelete.mockReturnValue({ where: deleteWhere });

    await expect(callAs().createContentItemVideo(validInput)).rejects.toThrow();

    const [whereCallback] = deleteWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const [submitArgs] = submitTranscodeJob.mock.calls[0]!;
    const result = whereCallback(
      { submissionNonce: 'submissionNonce' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith(
      'submissionNonce',
      submitArgs.submissionNonce,
    );
    expect(result).toBe(`submissionNonce = ${submitArgs.submissionNonce}`);
  });

  it('appends after the highest existing order', async () => {
    contentItemQueryPrimary.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: [{ ...contentItem, order: 3 }],
      }),
    });

    await callAs().createContentItemVideo(validInput);

    expect(contentItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ order: 4 }),
    );
  });
});

describe('createContentItemVideoUrl', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).createContentItemVideoUrl(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(
      callAs().createContentItemVideoUrl(input),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
  });

  it('returns only a plain playback URL, with the signed cookies on the response context', async () => {
    const responseCookies: string[] = [];
    const result = await caller({
      event: buildEvent(['instructor']),
      context: {} as any,
      info: {} as any,
      responseCookies,
    }).createContentItemVideoUrl(input);
    const expectedPrefix = contentItem.s3Key.slice(
      0,
      contentItem.s3Key.lastIndexOf('/') + 1,
    );
    expect(getSignedCloudFrontCookies).toHaveBeenCalledWith(expectedPrefix);
    expect(getCloudFrontVideoUrl).toHaveBeenCalledWith(contentItem.s3Key);
    // The cookies are HttpOnly: they must never appear in the JSON body.
    expect(result).toEqual({
      url: 'https://example.cloudfront.net/plain-url',
      withCredentials: true,
    });
    expect(responseCookies).toEqual([
      'CloudFront-Policy=fake; Domain=example.com',
    ]);
  });

  it.each(['pending', 'failed'] as const)(
    'throws NOT_FOUND when the content item status is %s',
    async (status) => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: { ...contentItem, status } }),
      });

      await expect(
        callAs().createContentItemVideoUrl(input),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(getSignedCloudFrontCookies).not.toHaveBeenCalled();
    },
  );
});

describe('updateContentItemVideo', () => {
  const input = {
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: CONTENT_ITEM_ID,
  };

  it('rejects callers who are not in the instructor group before checking course membership', async () => {
    await expect(
      callAs(['student']).updateContentItemVideo(input),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(courseInstructorGet).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the content item does not exist', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: undefined }),
    });

    await expect(callAs().updateContentItemVideo(input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('refuses to edit a video in an archived course, without touching MediaConvert', async () => {
    courseGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: { status: 'archived' } }),
    });

    await expect(callAs().updateContentItemVideo(input)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('refuses a replacement, without touching MediaConvert, when the lesson is archived in the meantime', async () => {
    lessonGet
      .mockReturnValueOnce({ go: vi.fn().mockResolvedValue({ data: lesson }) })
      .mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
        }),
      });
    lessonCheck.mockReturnValue({
      where: () => ({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      }),
    });

    await expect(
      callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/replacement.mp4`,
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson first',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('refuses to edit a video in an archived lesson before any side effect', async () => {
    lessonGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...lesson, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().updateContentItemVideo({ ...input, title: 'New title' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the lesson first',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: an archived item must be restored before it's edited --
  // including replacing its file, which must not touch S3 or MediaConvert.
  it('refuses to edit an archived video before any side effect', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({
        data: { ...contentItem, archivedAt: '2024-02-01T00:00:00.000Z' },
      }),
    });

    await expect(
      callAs().updateContentItemVideo({
        ...input,
        title: 'New title',
        objectKey: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/replacement.mp4`,
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the content item before editing it',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
    expect(getVideoUploadETag).not.toHaveBeenCalled();
    expect(submitTranscodeJob).not.toHaveBeenCalled();
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('only patches fields provided in the input', async () => {
    await callAs().updateContentItemVideo({
      ...input,
      title: 'Updated title',
    });

    expect(contentItemPatch).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
    });
    expect(contentItemPatchSet).toHaveBeenCalledWith({
      title: 'Updated title',
    });
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    // No new file was uploaded, so there's nothing to transcode.
    expect(submitTranscodeJob).not.toHaveBeenCalled();
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when a replacement objectKey does not match the lesson and content item', async () => {
    await expect(
      callAs().updateContentItemVideo({
        ...input,
        objectKey: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/other-lesson/content-items/some-id.mp4`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when a replacement objectKey does not point to an uploaded file', async () => {
    getVideoUploadETag.mockResolvedValue(undefined);

    await expect(
      callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });

  // A retry of this exact mutation (e.g. after a client-side timeout, even
  // though the original call actually succeeded) must not cancel and
  // resubmit a job that's already correctly running.
  describe('when the replacement looks like a retry of an in-flight submission', () => {
    const pendingObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const inFlightItem = {
      ...contentItem,
      status: 'pending' as const,
      s3Key: pendingObjectKey,
      mediaConvertJobId: 'job-1',
      rawObjectETag: OBJECT_ETAG,
      submissionNonce: 'existing-nonce',
    };

    it('reports the current state back unchanged, touching nothing', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });

      const result = await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      // mediaConvertJobId/rawObjectETag/submissionNonce are internal-only
      // and stripped by the tRPC output schema, same as any other response.
      const {
        mediaConvertJobId: _job,
        rawObjectETag: _etag,
        submissionNonce: _nonce,
        ...expected
      } = inFlightItem;
      expect(result).toEqual(expected);
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(contentItemPatch).not.toHaveBeenCalled();
      expect(submitTranscodeJob).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    });

    // Matching the upload only proves the transcode itself doesn't need
    // touching -- it says nothing about title/description/etc also being
    // unchanged (e.g. a retry after a lost response, with an edit made in
    // between). Those must still land.
    it('still applies supplied title/description edits, without touching the transcode', async () => {
      const updatedItem = {
        ...inFlightItem,
        title: 'New title',
        description: 'New description',
      };
      // The read before the write, then the re-read after it (transactions
      // don't return the written record).
      contentItemGet
        .mockReturnValueOnce({
          go: vi.fn().mockResolvedValue({ data: inFlightItem }),
        })
        .mockReturnValueOnce({
          go: vi.fn().mockResolvedValue({ data: updatedItem }),
        });

      const result = await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
        title: 'New title',
        description: 'New description',
      });

      expect(contentItemPatch).toHaveBeenCalledWith({
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
      });
      expect(contentItemPatchSet).toHaveBeenCalledWith({
        title: 'New title',
        description: 'New description',
      });
      expect(result.title).toBe('New title');
      expect(result.description).toBe('New description');
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(submitTranscodeJob).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
    });

    it('conditions the metadata-only patch on this record still owning the submission', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
        title: 'New title',
      });

      const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
      const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
      const notExists = vi.fn(
        (attr: string) => `attribute_not_exists(${attr})`,
      );
      const result = whereCallback(
        { submissionNonce: 'submissionNonce', archivedAt: 'archivedAt' },
        { eq, notExists },
      );

      expect(eq).toHaveBeenCalledWith(
        'submissionNonce',
        inFlightItem.submissionNonce,
      );
      expect(notExists).toHaveBeenCalledWith('archivedAt');
      expect(result).toBe(
        `submissionNonce = ${inFlightItem.submissionNonce} AND attribute_not_exists(archivedAt)`,
      );
    });

    it('throws CONFLICT, rather than reporting success, when the metadata edit loses ownership of the submission', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });
      contentItemPatchWhere.mockReturnValue({
        go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
      });

      await expect(
        callAs().updateContentItemVideo({
          ...input,
          objectKey: pendingObjectKey,
          title: 'New title',
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Content item was modified by another request; please retry',
      });
      expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
      expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
      expect(submitTranscodeJob).not.toHaveBeenCalled();
    });

    it('rethrows a transient failure applying the metadata edit instead of swallowing it', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });
      contentItemPatchWhere.mockReturnValue({
        go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
      });

      await expect(
        callAs().updateContentItemVideo({
          ...input,
          objectKey: pendingObjectKey,
          title: 'New title',
        }),
      ).rejects.toThrow('DynamoDB is unavailable');
    });

    it('does not short-circuit when the ETag differs (a genuine new replacement)', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...inFlightItem, rawObjectETag: '"a-different-etag"' },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });

    it('does not short-circuit when the objectKey differs', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: inFlightItem }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}yet-another-id.mp4`,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });

    it('does not short-circuit when no job has been stamped yet', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...inFlightItem, mediaConvertJobId: undefined },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });

    it('does not short-circuit an already-ready item even if s3Key happened to match', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...inFlightItem, status: 'ready' as const },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
      expect(submitTranscodeJob).toHaveBeenCalled();
    });
  });

  // The nonce feeds submitTranscodeJob's ClientRequestToken -- reusing the
  // record's own nonce (rather than a fresh one) is what lets a crashed
  // retry reconnect to whatever job that attempt already created, instead
  // of MediaConvert being asked to dedupe on a content fingerprint (see
  // mediaconvert-client.ts's docstring for why that was abandoned).
  describe('submissionNonce', () => {
    const pendingObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    it('reuses the existing nonce when resuming a submission that never got its job id stamped', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            status: 'pending' as const,
            s3Key: pendingObjectKey,
            mediaConvertJobId: undefined,
            submissionNonce: 'crashed-attempt-nonce',
          },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      expect(contentItemPatchSet).toHaveBeenCalledWith(
        expect.objectContaining({ submissionNonce: 'crashed-attempt-nonce' }),
      );
      expect(submitTranscodeJob).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionNonce: 'crashed-attempt-nonce',
        }),
      );
    });

    it('mints a fresh nonce for a genuinely new replacement (different objectKey)', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            status: 'pending' as const,
            s3Key: `${OBJECT_KEY_PREFIX}some-unrelated-id.mp4`,
            mediaConvertJobId: undefined,
            submissionNonce: 'unrelated-attempt-nonce',
          },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      const [patchArgs] = contentItemPatchSet.mock.calls[0]!;
      const [submitArgs] = submitTranscodeJob.mock.calls[0]!;
      expect(patchArgs.submissionNonce).not.toBe('unrelated-attempt-nonce');
      expect(submitArgs.submissionNonce).toBe(patchArgs.submissionNonce);
    });

    // A prior submission that already recorded a job id fully completed
    // its write cycle -- reusing its nonce here would let MediaConvert
    // dedupe onto that (soon to be canceled) job instead of the new
    // content this call is actually replacing it with.
    it('mints a fresh nonce when the content changed even though the objectKey and job id already recorded', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: {
            ...contentItem,
            status: 'pending' as const,
            s3Key: pendingObjectKey,
            mediaConvertJobId: 'job-1',
            rawObjectETag: '"a-different-etag"',
            submissionNonce: 'previous-attempt-nonce',
          },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      const [patchArgs] = contentItemPatchSet.mock.calls[0]!;
      expect(patchArgs.submissionNonce).not.toBe('previous-attempt-nonce');
      expect(bestEffortCancelTranscodeJobs).toHaveBeenCalled();
    });

    it('mints a fresh nonce for a brand new video with no prior attempt', async () => {
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({
          data: { ...contentItem, status: 'ready' as const },
        }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: pendingObjectKey,
      });

      const [patchArgs] = contentItemPatchSet.mock.calls[0]!;
      expect(patchArgs.submissionNonce).toBeTruthy();
    });
  });

  // Invariant: replacing a video's underlying file must not leave the old
  // object in the bucket, or the lesson media bucket accumulates orphans
  // every time an instructor swaps a video out. While
  // createContentItemVideoUploadUrl now reuses the real contentItemId in
  // the key when told it's a replacement (see its own tests above), this
  // procedure doesn't require that -- an objectKey scoped to the lesson but
  // carrying an unrelated id must still be accepted and cleaned up.
  it('keeps a ready video playing as the previous version while its replacement transcodes (#209)', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
      mimeType: 'video/webm',
    });

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      s3Key: newObjectKey,
      status: 'pending',
      submissionNonce: expect.any(String),
      previousS3Key: contentItem.s3Key,
      // Watched by the transcode reconciler until ready or failed (#125).
      transcodePending: 'pending',
      transcodePendingSince: expect.any(String),
      mimeType: 'video/webm',
    });
    // Retired by transcode-complete once the replacement is ready.
    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', 'still transcoding'],
    ['failed', 'failed'],
  ] as const)(
    'replacing a replacement that is %s deletes its upload and keeps the previous version',
    async (status) => {
      const previousS3Key = `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}/old-nonce/master.m3u8`;
      const replacing = {
        ...contentItem,
        status,
        s3Key: `${OBJECT_KEY_PREFIX}first-replacement.mp4`,
        submissionNonce: 'first-nonce',
        previousS3Key,
      };
      contentItemGet.mockReturnValue({
        go: vi.fn().mockResolvedValue({ data: replacing }),
      });

      await callAs().updateContentItemVideo({
        ...input,
        objectKey: `${OBJECT_KEY_PREFIX}second-replacement.mp4`,
      });

      // previousS3Key is neither set again nor removed: it stays.
      expect(contentItemPatchSet.mock.calls[0][0]).not.toHaveProperty(
        'previousS3Key',
      );
      expect(bestEffortDeleteContentItemVideos).toHaveBeenCalledWith(
        expect.anything(),
        [replacing],
      );
      // The previous version is still what students play.
      expect(bestEffortRetirePreviousVersions).not.toHaveBeenCalled();
    },
  );

  // Invariant: same as createContentItemVideo -- submitting the job only
  // after the DynamoDB patch has landed means a fast transcode can't race
  // ahead of the state it needs to find when it completes.
  it('submits the transcode job only after the DynamoDB patch when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const callOrder: string[] = [];
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockImplementation(async () => {
              callOrder.push('patch');
              return { data: contentItem };
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        where: () => ({
          go: vi.fn().mockImplementation(async () => {
            callOrder.push('patchJobId');
            return { data: contentItem };
          }),
        }),
      });
    submitTranscodeJob.mockImplementation(async () => {
      callOrder.push('submitTranscodeJob');
      return 'job-1';
    });

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(submitTranscodeJob).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: CONTENT_ITEM_ID,
      objectKey: newObjectKey,
      submissionNonce: expect.any(String),
    });
    expect(callOrder).toEqual(['patch', 'submitTranscodeJob', 'patchJobId']);
  });

  it('stamps the submitted job id onto the record when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(contentItemPatchSet).toHaveBeenCalledWith({
      mediaConvertJobId: 'job-1',
      rawObjectETag: OBJECT_ETAG,
    });
  });

  // Invariant: a failed submission during a replace has already canceled
  // whatever job the previous video had (if any), so there's no working
  // state left to restore to. Marking it failed -- the same terminal state
  // a genuine MediaConvert ERROR would produce -- gives the instructor an
  // accurate signal instead of an indefinite "processing" spinner.
  it('marks the content item failed when transcode submission fails during a replace', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toThrow('MediaConvert is unavailable');

    expect(contentItemPatchSet).toHaveBeenCalledWith({ status: 'failed' });
  });

  // Invariant: CreateJob succeeding means a real, billable job now exists
  // regardless of whether this stamp lands -- marking the record failed
  // here would orphan it. submissionNonce is already durable from the
  // first patch, so a later retry's crash-gap check reconnects to this
  // exact job instead, and transcode-complete.ts's own nonce-conditioned
  // patch reconciles status once the job actually finishes.
  it('does not mark the content item failed when only the job-id stamp fails after a successful replace submission', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        where: () => ({
          go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
        }),
      });

    const result = await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemPatchSet).not.toHaveBeenCalledWith({ status: 'failed' });
    expect(bestEffortCancelTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: same reasoning as createContentItemVideo's analogous test --
  // a second concurrent replacement could have already moved the record
  // onto its own nonce/job before this stamp lands, orphaning this
  // attempt's own job with nothing left to cancel or clean it up otherwise.
  it('cancels its own job when the stamp loses ownership to a newer replacement', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        where: () => ({
          go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
        }),
      });

    const result = await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(result).toMatchObject({ contentItemId: CONTENT_ITEM_ID });
    expect(contentItemPatchSet).not.toHaveBeenCalledWith({ status: 'failed' });
    expect(bestEffortCancelTranscodeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: 'job-1',
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: CONTENT_ITEM_ID,
      }),
    );
  });

  it('conditions the mark-failed patch on this attempt owning the record', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    const markFailedWhere = vi.fn().mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: contentItem }),
    });
    const markFailedRemove = vi.fn();
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        remove: (attributes: string[]) => {
          markFailedRemove(attributes);
          return { where: markFailedWhere };
        },
      });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toThrow('MediaConvert is unavailable');

    const [whereCallback] = markFailedWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const [firstPatchArgs] = contentItemPatchSet.mock.calls[0]!;
    const result = whereCallback(
      { submissionNonce: 'submissionNonce' },
      { eq },
    );

    expect(eq).toHaveBeenCalledWith(
      'submissionNonce',
      firstPatchArgs.submissionNonce,
    );
    expect(result).toBe(`submissionNonce = ${firstPatchArgs.submissionNonce}`);
    // Failed, so no longer waiting for a transcode (#125).
    expect(markFailedRemove).toHaveBeenCalledWith([
      'transcodePending',
      'transcodePendingSince',
    ]);
  });

  it('still surfaces the original submission error even if marking it failed also fails', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    submitTranscodeJob.mockRejectedValue(
      new Error('MediaConvert is unavailable'),
    );
    contentItemPatchSet
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockResolvedValue({ data: contentItem }),
          }),
        }),
      })
      .mockReturnValueOnce({
        remove: () => ({
          where: () => ({
            go: vi.fn().mockRejectedValue(new Error('DynamoDB is unavailable')),
          }),
        }),
      });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toThrow('MediaConvert is unavailable');
  });

  // bestEffortCancelTranscodeJobs itself decides which items are actually
  // cancelable (status/job-id filtering covered in mediaconvert-client.test.ts);
  // this only needs to confirm updateContentItemVideo hands it the
  // pre-patch record whenever a replacement happens.
  it('passes the pre-replacement record to bestEffortCancelTranscodeJobs when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(bestEffortCancelTranscodeJobs).toHaveBeenCalledWith(
      expect.anything(),
      [contentItem],
    );
  });

  // Invariant: cancellation schedules cleanup for the previous job's
  // output regardless of whether the cancel itself succeeds -- so it must
  // only run once this request's own conditional patch has proven its
  // view of the record is still current. Calling it beforehand risks
  // scheduling deletion of content that turns out to still be the
  // record's own current, legitimate output (e.g. the previous job
  // finished for real in the window between this request's initial read
  // and now, which the patch's own condition would catch and reject as
  // CONFLICT -- but only if cancellation hasn't already run by then).
  it('cancels the previous job only after the replacement patch has landed', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const callOrder: string[] = [];
    contentItemPatchSet.mockReturnValueOnce({
      remove: () => ({
        where: () => ({
          go: vi.fn().mockImplementation(async () => {
            callOrder.push('patch');
            return { data: contentItem };
          }),
        }),
      }),
    });
    bestEffortCancelTranscodeJobs.mockImplementation(async () => {
      callOrder.push('cancel');
    });

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(callOrder).toEqual(['patch', 'cancel']);
  });

  // Invariant: two updateContentItemVideo replace calls for the same
  // content item racing each other would otherwise both submit a job
  // writing to the same S3 destination (#123). Conditioning the patch on
  // status/s3Key still matching what was read means whichever call lands
  // second sees its own DynamoDB write fail, rather than silently
  // proceeding to race the first call's job.
  it('throws CONFLICT when another request has already changed status/s3Key (concurrent replace)', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Content item was modified by another request; please retry',
    });
    expect(submitTranscodeJob).not.toHaveBeenCalled();
  });

  // Invariant: a rejected replacement must leave the previous job (and
  // whatever content it's currently pointing at) completely untouched --
  // no cancellation attempt, and critically no cleanup scheduled for it,
  // since a CONFLICT here specifically means the record's real current
  // state no longer matches what this request read, so that job's output
  // may well still be the content item's own current, legitimate content.
  it('does not cancel the previous job when the replacement patch is rejected as a conflict', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    contentItemPatchWhere.mockReturnValue({
      go: vi.fn().mockRejectedValue(conditionalCheckFailedError()),
    });

    await expect(
      callAs().updateContentItemVideo({ ...input, objectKey: newObjectKey }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortCancelTranscodeJobs).not.toHaveBeenCalled();
  });

  it('conditions the patch on the status and s3Key read at the start of the call', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const notExists = vi.fn((attr: string) => `attribute_not_exists(${attr})`);
    const result = whereCallback(
      { status: 'status', s3Key: 's3Key', archivedAt: 'archivedAt' },
      { eq, notExists },
    );

    expect(eq).toHaveBeenCalledWith('status', contentItem.status);
    expect(eq).toHaveBeenCalledWith('s3Key', contentItem.s3Key);
    expect(result).toBe(
      `status = ${contentItem.status} AND s3Key = ${contentItem.s3Key} AND attribute_not_exists(archivedAt)`,
    );
  });

  // Invariant: objectKey is deterministic from contentItemId + extension,
  // so two concurrent same-extension replacements of an already-pending
  // item can read identical status/s3Key values on both sides of the race
  // -- status/s3Key alone wouldn't always catch that second race. Also
  // including submissionNonce (freshly randomized per call) closes it.
  it('also conditions the patch on submissionNonce when the existing record has one', async () => {
    const pendingObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;
    const pendingItem = {
      ...contentItem,
      status: 'pending' as const,
      s3Key: pendingObjectKey,
      mediaConvertJobId: 'job-1',
      rawObjectETag: 'a-different-etag',
      submissionNonce: 'nonce-1',
    };
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: pendingItem }),
    });

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: pendingObjectKey,
    });

    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const notExists = vi.fn((attr: string) => `attribute_not_exists(${attr})`);
    const result = whereCallback(
      {
        status: 'status',
        s3Key: 's3Key',
        submissionNonce: 'submissionNonce',
        archivedAt: 'archivedAt',
      },
      { eq, notExists },
    );

    expect(eq).toHaveBeenCalledWith('submissionNonce', 'nonce-1');
    expect(result).toBe(
      `status = ${pendingItem.status} AND s3Key = ${pendingItem.s3Key} AND submissionNonce = nonce-1 AND attribute_not_exists(archivedAt)`,
    );
  });

  // Invariant: leaving the previous video's mediaConvertJobId in place
  // would make it indistinguishable, on a later retry, from a stale id
  // that no longer means anything -- a crash between submitTranscodeJob
  // succeeding and the follow-up stamp would then be read as "already
  // fully submitted with a defined (but wrong) job id" instead of "no job
  // stamped for this attempt yet", failing the crash-gap nonce-reuse
  // check and submitting a duplicate job instead of reconnecting to the
  // one that attempt already created.
  it('clears the previous mediaConvertJobId when replacing the file', async () => {
    const newObjectKey = `${OBJECT_KEY_PREFIX}some-other-fresh-id.mp4`;

    await callAs().updateContentItemVideo({
      ...input,
      objectKey: newObjectKey,
    });

    expect(contentItemPatchRemove).toHaveBeenCalledWith(['mediaConvertJobId']);
  });

  it('does not condition a metadata-only edit on status/s3Key (no CONFLICT risk from a concurrent replace)', async () => {
    await callAs().updateContentItemVideo({
      ...input,
      title: 'Updated title',
    });

    // Only on the item not having been archived since it was read.
    const [whereCallback] = contentItemPatchWhere.mock.calls[0]!;
    const eq = vi.fn((attr: string, value: string) => `${attr} = ${value}`);
    const notExists = vi.fn((attr: string) => `attribute_not_exists(${attr})`);
    const result = whereCallback(
      {
        status: 'status',
        s3Key: 's3Key',
        submissionNonce: 'submissionNonce',
        archivedAt: 'archivedAt',
      },
      { eq, notExists },
    );

    expect(eq).not.toHaveBeenCalled();
    expect(result).toBe('attribute_not_exists(archivedAt)');
  });

  it('does not attempt an S3 delete when the objectKey is unchanged', async () => {
    await callAs().updateContentItemVideo({
      ...input,
      objectKey: contentItem.s3Key,
    });

    expect(bestEffortDeleteContentItemVideos).not.toHaveBeenCalled();
  });

  it('throws BAD_REQUEST when the existing content item is not a video', async () => {
    contentItemGet.mockReturnValue({
      go: vi.fn().mockResolvedValue({ data: textContentItem }),
    });

    await expect(callAs().updateContentItemVideo(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(contentItemPatch).not.toHaveBeenCalled();
  });
});
