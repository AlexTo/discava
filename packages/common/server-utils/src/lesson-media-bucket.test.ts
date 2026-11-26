/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module is re-imported per test so no module state leaks between tests.
const importFreshModule = async () => {
  vi.resetModules();
  return import('./lesson-media-bucket.js');
};

const UPLOAD_BUCKET_NAME = 'lesson-media-upload-bucket';

beforeEach(() => {
  vi.stubEnv(
    'DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET_BUCKET_NAME',
    UPLOAD_BUCKET_NAME,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveLessonMediaUploadBucketName', () => {
  it('resolves the upload bucket name from the s3 namespace', async () => {
    const { resolveLessonMediaUploadBucketName } = await importFreshModule();

    await expect(resolveLessonMediaUploadBucketName()).resolves.toBe(
      UPLOAD_BUCKET_NAME,
    );
  });

  it('throws when the setting is not set', async () => {
    vi.stubEnv('DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET_BUCKET_NAME', '');
    const { resolveLessonMediaUploadBucketName } = await importFreshModule();

    await expect(resolveLessonMediaUploadBucketName()).rejects.toThrow(
      'Missing deploy-time setting DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET_BUCKET_NAME',
    );
  });
});

describe('resolveBucketName', () => {
  it.each([
    ['LessonMediaBucket', 'discava-lesson-media'],
    ['LessonMediaUploadBucket', 'discava-lesson-media-upload'],
    ['PublicMediaBucket', 'discava-public-media'],
  ])(
    'uses S3Mock’s %s in local dev, without a setting',
    async (key, bucket) => {
      vi.stubEnv('LOCAL_DEV', 'true');
      try {
        const { resolveBucketName } = await importFreshModule();
        await expect(resolveBucketName(key)).resolves.toBe(bucket);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
