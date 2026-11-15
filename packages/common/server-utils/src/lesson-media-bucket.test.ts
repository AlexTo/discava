/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppConfig } = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/parameters/appconfig', () => ({
  getAppConfig,
}));

// The resolver caches its resolved value at module scope, so reusing one
// import across tests with different mock setups would leak the first
// successful resolution into later tests -- reset and re-import per test.
const importFreshModule = async () => {
  vi.resetModules();
  return import('./lesson-media-bucket.js');
};

const UPLOAD_BUCKET_NAME = 'lesson-media-upload-bucket';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RUNTIME_CONFIG_APP_ID = 'app-1';
  getAppConfig.mockResolvedValue({
    LessonMediaUploadBucket: { bucketName: UPLOAD_BUCKET_NAME },
  });
});

describe('resolveLessonMediaUploadBucketName', () => {
  it('resolves the upload bucket name from the s3 namespace', async () => {
    const { resolveLessonMediaUploadBucketName } = await importFreshModule();

    await expect(resolveLessonMediaUploadBucketName()).resolves.toBe(
      UPLOAD_BUCKET_NAME,
    );
  });

  it('caches the resolved value across calls', async () => {
    const { resolveLessonMediaUploadBucketName } = await importFreshModule();

    await resolveLessonMediaUploadBucketName();
    await resolveLessonMediaUploadBucketName();

    expect(getAppConfig).toHaveBeenCalledTimes(1);
  });

  it('throws when RUNTIME_CONFIG_APP_ID is not set', async () => {
    delete process.env.RUNTIME_CONFIG_APP_ID;
    const { resolveLessonMediaUploadBucketName } = await importFreshModule();

    await expect(resolveLessonMediaUploadBucketName()).rejects.toThrow(
      'RUNTIME_CONFIG_APP_ID environment variable is not set',
    );
  });

  it('throws when the key is missing from runtime config', async () => {
    getAppConfig.mockResolvedValue({});
    const { resolveLessonMediaUploadBucketName } = await importFreshModule();

    await expect(resolveLessonMediaUploadBucketName()).rejects.toThrow(
      'Could not resolve s3.LessonMediaUploadBucket from runtime config',
    );
  });
});

describe('resolveBucketName', () => {
  it.each([
    ['LessonMediaBucket', 'discava-lesson-media'],
    ['LessonMediaUploadBucket', 'discava-lesson-media-upload'],
    ['PublicMediaBucket', 'discava-public-media'],
  ])(
    'uses S3Mock’s %s in local dev, without AppConfig',
    async (key, bucket) => {
      vi.stubEnv('LOCAL_DEV', 'true');
      try {
        const { resolveBucketName } = await importFreshModule();
        await expect(resolveBucketName(key)).resolves.toBe(bucket);
        expect(getAppConfig).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
