/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bestEffortDeleteContentItemVideos,
  bestEffortRetirePreviousVersions,
  getVideoUploadETag,
} from './s3-client.js';

const { send, getAppConfig, scheduleTranscodeCleanup } = vi.hoisted(() => ({
  send: vi.fn(),
  getAppConfig: vi.fn(),
  scheduleTranscodeCleanup: vi.fn(),
}));

// Plain function expressions, not arrow functions: S3Client is constructed
// with `new` in s3-client.ts, and arrow functions can never be
// constructors.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send };
  }),
  ListObjectsV2Command: vi.fn(function (input) {
    return { __command: 'ListObjectsV2', ...input };
  }),
  DeleteObjectsCommand: vi.fn(function (input) {
    return { __command: 'DeleteObjects', ...input };
  }),
  HeadObjectCommand: vi.fn(function (input) {
    return { __command: 'HeadObject', ...input };
  }),
}));

vi.mock('@aws-lambda-powertools/parameters/appconfig', () => ({
  getAppConfig,
}));

vi.mock('./transcode-cleanup-scheduler.js', () => ({
  scheduleTranscodeCleanup,
}));

const MEDIA_BUCKET_NAME = 'lesson-media-bucket';
const UPLOAD_BUCKET_NAME = 'lesson-media-upload-bucket';

const COURSE_ID = 'course-1';
const MODULE_ID = 'module-1';
const LESSON_ID = 'lesson-1';

// The common case going forward: every 'ready' item created since
// submissionNonce existed has one. Its cleanup is scheduled, not deleted
// inline -- see readyItemWithoutNonce below for the legacy fallback path.
const readyItem = (contentItemId: string, submissionNonce = 'nonce-1') => ({
  status: 'ready',
  s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${contentItemId}/${submissionNonce}/master.m3u8`,
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId,
  submissionNonce,
});

// A 'ready' item from before submissionNonce existed -- falls back to the
// old inline list+delete of the whole content-item prefix.
const readyItemWithoutNonce = (contentItemId: string) => ({
  status: 'ready',
  s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${contentItemId}/master.m3u8`,
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId,
});

const pendingItem = (contentItemId: string, ext = 'mp4') => ({
  status: 'pending',
  s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/${contentItemId}.${ext}`,
  courseId: COURSE_ID,
  moduleId: MODULE_ID,
  lessonId: LESSON_ID,
  contentItemId,
});

describe('bestEffortDeleteContentItemVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNTIME_CONFIG_APP_ID = 'app-1';
    getAppConfig.mockImplementation((namespace: string) => {
      if (namespace === 's3') {
        return Promise.resolve({
          LessonMediaBucket: { bucketName: MEDIA_BUCKET_NAME },
          LessonMediaUploadBucket: { bucketName: UPLOAD_BUCKET_NAME },
        });
      }
      return Promise.resolve({});
    });
    send.mockImplementation((command: any) => {
      if (command.__command === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: [{ Key: command.Prefix + 'master.m3u8' }],
        });
      }
      return Promise.resolve({});
    });
  });

  it('does nothing when given no content items', async () => {
    await bestEffortDeleteContentItemVideos(undefined, []);
    expect(send).not.toHaveBeenCalled();
  });

  // The common case: a paginated inline list+delete across a ready
  // video's (potentially many) segments would delay this response for no
  // benefit, since nothing about it needs to happen before responding --
  // scheduling reuses the exact mechanism a canceled job's own cleanup
  // already goes through.
  it('schedules a cleanup instead of deleting inline for a ready item with a submissionNonce', async () => {
    await bestEffortDeleteContentItemVideos(undefined, [
      readyItem('content-item-1', 'nonce-1'),
    ]);

    expect(scheduleTranscodeCleanup).toHaveBeenCalledWith(undefined, {
      courseId: COURSE_ID,
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      contentItemId: 'content-item-1',
      submissionNonce: 'nonce-1',
    });
    expect(
      send.mock.calls.some(
        ([command]: any[]) => command.Bucket === MEDIA_BUCKET_NAME,
      ),
    ).toBe(false);
  });

  // The replace path calls this to drop an abandoned replacement's upload
  // while the item still plays its previous version (#209).
  it('leaves a replacement’s previous version alone', async () => {
    await bestEffortDeleteContentItemVideos(undefined, [
      {
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: 'content-item-1',
        status: 'pending',
        s3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1.mp4`,
        submissionNonce: 'replacement-nonce',
        previousS3Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/old-nonce/master.m3u8`,
      },
    ]);

    expect(scheduleTranscodeCleanup).not.toHaveBeenCalled();
  });

  it('falls back to deleting the whole content-item prefix inline for a ready item with no submissionNonce', async () => {
    await bestEffortDeleteContentItemVideos(undefined, [
      readyItemWithoutNonce('content-item-1'),
    ]);

    expect(scheduleTranscodeCleanup).not.toHaveBeenCalled();

    const listCall = send.mock.calls.find(
      ([command]: any[]) => command.__command === 'ListObjectsV2',
    );
    expect(listCall![0]).toMatchObject({
      Bucket: MEDIA_BUCKET_NAME,
      Prefix: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/`,
    });

    const deleteCall = send.mock.calls.find(
      ([command]: any[]) => command.__command === 'DeleteObjects',
    );
    expect(deleteCall![0]).toMatchObject({
      Bucket: MEDIA_BUCKET_NAME,
      Delete: {
        Objects: [
          {
            Key: `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/master.m3u8`,
          },
        ],
      },
    });
  });

  // S3's ListObjectsV2 caps a single page at 1,000 keys; a lesson video's
  // HLS output (4 renditions x 6s segments) can exceed that on its own, so
  // this must keep paging until IsTruncated is false or it silently misses
  // everything past the first page. Exercised via the no-nonce fallback
  // path -- the only one that still does this listing inline.
  it('paginates ListObjectsV2 until IsTruncated is false', async () => {
    const prefix = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/`;
    send.mockImplementation((command: any) => {
      if (command.__command === 'ListObjectsV2') {
        if (!command.ContinuationToken) {
          return Promise.resolve({
            Contents: [{ Key: `${prefix}page1.ts` }],
            IsTruncated: true,
            NextContinuationToken: 'token-1',
          });
        }
        if (command.ContinuationToken === 'token-1') {
          return Promise.resolve({
            Contents: [{ Key: `${prefix}page2.ts` }],
            IsTruncated: false,
          });
        }
      }
      return Promise.resolve({});
    });

    await bestEffortDeleteContentItemVideos(undefined, [
      readyItemWithoutNonce('content-item-1'),
    ]);

    const listCalls = send.mock.calls.filter(
      ([command]: any[]) => command.__command === 'ListObjectsV2',
    );
    expect(listCalls).toHaveLength(2);

    const deleteCall = send.mock.calls.find(
      ([command]: any[]) => command.__command === 'DeleteObjects',
    );
    expect(deleteCall![0].Delete.Objects).toEqual([
      { Key: `${prefix}page1.ts` },
      { Key: `${prefix}page2.ts` },
    ]);
  });

  it('deletes whatever was listed before a pagination failure, rather than nothing', async () => {
    const prefix = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/`;
    send.mockImplementation((command: any) => {
      if (command.__command === 'ListObjectsV2') {
        if (!command.ContinuationToken) {
          return Promise.resolve({
            Contents: [{ Key: `${prefix}page1.ts` }],
            IsTruncated: true,
            NextContinuationToken: 'token-1',
          });
        }
        return Promise.reject(new Error('S3 is unavailable'));
      }
      return Promise.resolve({});
    });
    const logger = { error: vi.fn() };

    await bestEffortDeleteContentItemVideos(logger as any, [
      readyItemWithoutNonce('content-item-1'),
    ]);

    const deleteCall = send.mock.calls.find(
      ([command]: any[]) => command.__command === 'DeleteObjects',
    );
    expect(deleteCall![0].Delete.Objects).toEqual([
      { Key: `${prefix}page1.ts` },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to list lesson media objects from S3',
      expect.objectContaining({ prefix }),
    );
  });

  // S3's DeleteObjects caps a single call at 1,000 keys and rejects the
  // whole request outright if given more, rather than partially applying it.
  it('chunks a delete into multiple calls when there are more than 1,000 keys', async () => {
    const prefix = `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/`;
    const manyKeys = Array.from(
      { length: 1500 },
      (_, i) => `${prefix}segment-${i}.ts`,
    );
    send.mockImplementation((command: any) => {
      if (command.__command === 'ListObjectsV2') {
        return Promise.resolve({
          Contents: manyKeys.map((Key) => ({ Key })),
          IsTruncated: false,
        });
      }
      return Promise.resolve({});
    });

    await bestEffortDeleteContentItemVideos(undefined, [
      readyItemWithoutNonce('content-item-1'),
    ]);

    const deleteCalls = send.mock.calls.filter(
      ([command]: any[]) => command.__command === 'DeleteObjects',
    );
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0]![0].Delete.Objects).toHaveLength(1000);
    expect(deleteCalls[1]![0].Delete.Objects).toHaveLength(500);
  });

  it('deletes the single raw object from the upload bucket for a non-ready item', async () => {
    const item = pendingItem('content-item-2');

    await bestEffortDeleteContentItemVideos(undefined, [item]);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'DeleteObjects',
        Bucket: UPLOAD_BUCKET_NAME,
        Delete: { Objects: [{ Key: item.s3Key }] },
      }),
    );
  });

  it('schedules cleanup for a ready item and inline-deletes non-ready items in the same call', async () => {
    await bestEffortDeleteContentItemVideos(undefined, [
      readyItem('content-item-1', 'nonce-1'),
      pendingItem('content-item-2'),
      pendingItem('content-item-3', 'webm'),
    ]);

    expect(scheduleTranscodeCleanup).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ contentItemId: 'content-item-1' }),
    );

    const deleteCalls = send.mock.calls.filter(
      ([command]: any[]) => command.__command === 'DeleteObjects',
    );
    // Only the upload bucket, one call for both pending items' raw
    // uploads -- the ready item's cleanup was scheduled, not deleted here.
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]![0].Bucket).toBe(UPLOAD_BUCKET_NAME);
  });

  it('batches multiple no-nonce ready items and non-ready items into one delete call per bucket', async () => {
    await bestEffortDeleteContentItemVideos(undefined, [
      readyItemWithoutNonce('content-item-1'),
      pendingItem('content-item-2'),
      pendingItem('content-item-3', 'webm'),
    ]);

    const deleteCalls = send.mock.calls.filter(
      ([command]: any[]) => command.__command === 'DeleteObjects',
    );
    expect(deleteCalls).toHaveLength(2);
    expect(
      deleteCalls.map(([command]: any[]) => command.Bucket).sort(),
    ).toEqual([MEDIA_BUCKET_NAME, UPLOAD_BUCKET_NAME].sort());
  });

  it('skips an item with no s3Key', async () => {
    await bestEffortDeleteContentItemVideos(undefined, [
      { ...pendingItem('content-item-4'), s3Key: undefined },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  // Invariant: the DynamoDB record is the source of truth for whether a
  // piece of content exists, so a failure to delete its S3 object(s) must
  // never surface to (or fail) the caller.
  it('does not throw when the media bucket list fails', async () => {
    send.mockImplementation((command: any) => {
      if (command.__command === 'ListObjectsV2') {
        return Promise.reject(new Error('S3 is unavailable'));
      }
      return Promise.resolve({});
    });

    await expect(
      bestEffortDeleteContentItemVideos(undefined, [
        readyItemWithoutNonce('content-item-1'),
      ]),
    ).resolves.toBeUndefined();
  });

  it('does not throw when a delete call fails, and logs it', async () => {
    send.mockImplementation((command: any) => {
      if (command.__command === 'DeleteObjects') {
        return Promise.reject(new Error('S3 is unavailable'));
      }
      return Promise.resolve({});
    });
    const logger = { error: vi.fn() };

    await expect(
      bestEffortDeleteContentItemVideos(logger as any, [
        pendingItem('content-item-2'),
      ]),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to delete lesson media objects from S3',
      expect.objectContaining({ bucket: UPLOAD_BUCKET_NAME }),
    );
  });

  it('tolerates a missing logger when a delete fails', async () => {
    send.mockRejectedValue(new Error('S3 is unavailable'));

    await expect(
      bestEffortDeleteContentItemVideos(undefined, [
        pendingItem('content-item-2'),
      ]),
    ).resolves.toBeUndefined();
  });

  // DeleteObjects can resolve successfully and still fail individual keys
  // -- that doesn't reject the promise, so a per-key failure has to be
  // checked explicitly or it's silently lost and never logged.
  it('does not throw but logs it when DeleteObjects reports per-key errors', async () => {
    send.mockImplementation((command: any) => {
      if (command.__command === 'DeleteObjects') {
        return Promise.resolve({
          Errors: [
            {
              Key: 'some-key.mp4',
              Code: 'InternalError',
              Message: 'We encountered an internal error',
            },
          ],
        });
      }
      return Promise.resolve({});
    });
    const logger = { error: vi.fn() };

    await expect(
      bestEffortDeleteContentItemVideos(logger as any, [
        pendingItem('content-item-2'),
      ]),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to delete some lesson media objects from S3',
      expect.objectContaining({
        bucket: UPLOAD_BUCKET_NAME,
        errors: expect.arrayContaining([
          expect.objectContaining({ Key: 'some-key.mp4' }),
        ]),
      }),
    );
  });
});

describe('getVideoUploadETag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNTIME_CONFIG_APP_ID = 'app-1';
    getAppConfig.mockImplementation((namespace: string) => {
      if (namespace === 's3') {
        return Promise.resolve({
          LessonMediaUploadBucket: { bucketName: UPLOAD_BUCKET_NAME },
        });
      }
      return Promise.resolve({});
    });
  });

  it('returns the ETag when the object exists', async () => {
    send.mockResolvedValue({ ETag: '"etag-1"' });

    await expect(getVideoUploadETag('some-key.mp4')).resolves.toBe('"etag-1"');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        __command: 'HeadObject',
        Bucket: UPLOAD_BUCKET_NAME,
        Key: 'some-key.mp4',
      }),
    );
  });

  it('returns undefined when the object does not exist', async () => {
    const notFound = new Error('not found');
    notFound.name = 'NotFound';
    send.mockRejectedValue(notFound);

    await expect(
      getVideoUploadETag('missing-key.mp4'),
    ).resolves.toBeUndefined();
  });

  it('rethrows any other error', async () => {
    send.mockRejectedValue(new Error('S3 is unavailable'));

    await expect(getVideoUploadETag('some-key.mp4')).rejects.toThrow(
      'S3 is unavailable',
    );
  });
});

describe('bestEffortRetirePreviousVersions', () => {
  beforeEach(() => vi.clearAllMocks());

  const item = (previousS3Key?: string) => ({
    courseId: COURSE_ID,
    moduleId: MODULE_ID,
    lessonId: LESSON_ID,
    contentItemId: 'content-item-1',
    status: 'pending',
    previousS3Key,
  });

  it('schedules a deleted item’s previous version once its cookies have expired', async () => {
    await bestEffortRetirePreviousVersions(undefined, [
      item(
        `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/old-nonce/master.m3u8`,
      ),
    ]);

    expect(scheduleTranscodeCleanup).toHaveBeenCalledWith(
      undefined,
      {
        courseId: COURSE_ID,
        moduleId: MODULE_ID,
        lessonId: LESSON_ID,
        contentItemId: 'content-item-1',
        submissionNonce: 'old-nonce',
      },
      // Four hours of cookies, and a margin.
      255,
    );
  });

  it('skips items without one, and one from before nonces', async () => {
    await bestEffortRetirePreviousVersions(undefined, [
      item(),
      item(
        `courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/content-items/content-item-1/master.m3u8`,
      ),
    ]);

    expect(scheduleTranscodeCleanup).not.toHaveBeenCalled();
  });
});
