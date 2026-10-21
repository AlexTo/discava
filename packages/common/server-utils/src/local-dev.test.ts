/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localBucketName, s3ClientConfig } from './local-dev.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('s3ClientConfig', () => {
  it('leaves a deployed Lambda’s S3 client to its defaults', () => {
    vi.stubEnv('LOCAL_DEV', undefined);

    expect(s3ClientConfig()).toEqual({});
  });

  it('points local dev at S3Mock, with path-style URLs', () => {
    vi.stubEnv('LOCAL_DEV', 'true');

    expect(s3ClientConfig()).toMatchObject({
      endpoint: 'http://localhost:9090',
      forcePathStyle: true,
    });
  });
});

describe('localBucketName', () => {
  it('names the S3Mock bucket for a runtime config key', () => {
    expect(localBucketName('PublicMediaBucket')).toBe('discava-public-media');
  });

  it('refuses a key with no local bucket', () => {
    expect(() => localBucketName('SomethingElse')).toThrow(
      'No local bucket for SomethingElse',
    );
  });
});
