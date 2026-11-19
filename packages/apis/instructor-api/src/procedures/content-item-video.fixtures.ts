/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  aContentItem,
  aLesson,
  mockCoreTable,
} from '@discava/common-server-utils/trpc-testing';
import { vi } from 'vitest';

// What content-item-video*.test.ts share: the mocked tables, S3 and
// MediaConvert helpers, the fixture records and the fake transaction. A test
// file mocks `@discava/core-table` with `spies.mockModule`, which has to be
// hoisted above the procedure imports, so this module imports no procedure.

export const spies = {
  ...mockCoreTable({
    module: ['get'],
    course: ['get'],
    courseInstructor: ['get'],
    lesson: ['get'],
    contentItem: ['query.primary', 'create', 'get', 'patch', 'delete'],
    transaction: ['write'],
  }),
  courseCheck: vi.fn(),
  moduleCheck: vi.fn(),
  lessonCheck: vi.fn(),
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
  contentItemPatchSet: vi.fn(),
  contentItemPatchRemove: vi.fn(),
  contentItemPatchWhere: vi.fn(),
};
export const {
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
} = spies;

export const INSTRUCTOR_SUB = 'instructor-1';
export const COURSE_ID = 'course-1';
export const MODULE_ID = 'module-1';
export const LESSON_ID = 'lesson-1';
export const CONTENT_ITEM_ID = 'content-item-1';
export const BUCKET_NAME = 'lesson-media-bucket';
export const OBJECT_ETAG = '"etag-1"';

// Matches the shape isConditionalCheckFailed checks for -- an ElectroError
// wrapping the underlying AWS SDK exception, the same shape observed from
// a real DynamoDB conditional write rejection.
export const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    cause: Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    }),
  });

// Gives a mocked ElectroDB chain the `.commit()` a transaction item needs,
// at every step of the chain. Committing defers to that step's own `.go()`,
// which the fake transaction below runs, so a test drives a transactional
// write's outcome the same way as a direct one: by what its `.go()` does.
export const committable = (chain: any): any => {
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
export const transactionEntities = {
  course: { check: (key: unknown) => committable(courseCheck(key)) },
  module: { check: (key: unknown) => committable(moduleCheck(key)) },
  lesson: {
    check: (key: unknown) => committable(lessonCheck(key)),
    // Appending to the lesson claims its next order (#71), behind the same
    // condition as the check.
    patch: (key: unknown) => committable({ set: () => lessonCheck(key) }),
  },
  contentItem: {
    create: (item: unknown) => committable(contentItemCreate(item)),
    patch: (key: unknown) => committable(contentItemPatch(key)),
  },
};

export const isConditionalCheckFailedError = (error: unknown) =>
  error instanceof Error &&
  error.cause instanceof Error &&
  error.cause.name === 'ConditionalCheckFailedException';

// Runs the transaction's items in order (ancestor checks first, as built).
// An item whose `.go()` fails its condition cancels the transaction, reported
// the way DynamoDB does: a per-item result with that item's code. Any other
// failure rejects the transaction itself, like a transient DynamoDB error.
export const fakeTransactionWrite = (
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

export const lesson = aLesson();

export const OBJECT_KEY_PREFIX = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/`;

export const contentItem = aContentItem({
  s3Key: `${OBJECT_KEY_PREFIX}${CONTENT_ITEM_ID}.mp4`,
  mimeType: 'video/mp4',
});

export const textBody = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

export const textContentItem = aContentItem({
  type: 'text',
  title: 'Welcome notes',
  body: textBody,
});

export const installDefaults = () => {
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
};
