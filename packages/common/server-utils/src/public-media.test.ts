/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as s3 from './lesson-media-bucket.js';
import {
  bestEffortDetachPublicMediaObject,
  courseImageKey,
  getPublicMediaObjectBytes,
  headPublicMediaObject,
  instructorPhotoKey,
  isCourseImageKey,
  isInstructorPhotoKey,
  presignJpegUpload,
  presignPublicMediaUpload,
} from './public-media.js';

const NONCE = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('isCourseImageKey', () => {
  it('accepts a key courseImageKey made for the course', () => {
    expect(
      isCourseImageKey('course-1', courseImageKey('course-1', NONCE)),
    ).toBe(true);
  });

  it.each([
    ['another course’s', courseImageKey('course-2', NONCE)],
    ['a lesson video’s', `courses/course-1/modules/m/lessons/l/${NONCE}.jpg`],
    ['a made-up', 'courses/course-1/image/../../other.jpg'],
  ])('refuses %s key', (_, key) => {
    expect(isCourseImageKey('course-1', key)).toBe(false);
  });
});

describe('isInstructorPhotoKey', () => {
  it('accepts a key instructorPhotoKey made for the instructor', () => {
    expect(isInstructorPhotoKey('i-1', instructorPhotoKey('i-1', NONCE))).toBe(
      true,
    );
  });

  it.each([
    ['another instructor’s', instructorPhotoKey('i-2', NONCE)],
    ['a course image', courseImageKey('i-1', NONCE)],
    ['a nested', `instructors/i-1/x/${NONCE}.jpg`],
    ['a made-up', 'instructors/i-1/../i-2/other.jpg'],
  ])('refuses %s key', (_, key) => {
    expect(isInstructorPhotoKey('i-1', key)).toBe(false);
  });
});

describe('public media S3 helpers', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    vi.stubEnv(
      'DISCAVA_S3_PUBLIC_MEDIA_BUCKET',
      JSON.stringify({ bucketName: 'public-media' }),
    );
    vi.spyOn(s3, 'getS3Client').mockReturnValue({ send } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('getPublicMediaObjectBytes returns the body', async () => {
    send.mockResolvedValue({
      ContentLength: 3,
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    expect(await getPublicMediaObjectBytes('brand/x.png', 10)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('getPublicMediaObjectBytes refuses a body longer than maxBytes', async () => {
    send.mockResolvedValue({
      ContentLength: 11,
      Body: { transformToByteArray: vi.fn() },
    });
    await expect(getPublicMediaObjectBytes('brand/x.png', 10)).rejects.toThrow(
      /longer than 10/,
    );
  });

  it('getPublicMediaObjectBytes refuses a body longer than it declared', async () => {
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(11) },
    });
    await expect(getPublicMediaObjectBytes('brand/x.png', 10)).rejects.toThrow(
      /longer than 10/,
    );
  });

  it('getPublicMediaObjectBytes returns undefined for a missing object', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'NoSuchKey' }),
    );
    expect(await getPublicMediaObjectBytes('brand/x.png', 10)).toBeUndefined();
  });

  const useRealClient = () =>
    vi.spyOn(s3, 'getS3Client').mockReturnValue(
      new S3Client({
        region: 'us-east-1',
        credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      }),
    );

  it('presignPublicMediaUpload signs type, length, cache control and tag', async () => {
    useRealClient();
    const { uploadUrl, headers } = await presignPublicMediaUpload({
      key: 'brand/logo/a.png',
      contentType: 'image/png',
      contentLength: 5,
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(uploadUrl).toContain('brand/logo/a.png');
    expect(uploadUrl.toLowerCase()).toContain('x-amz-signedheaders');
    expect(headers).toEqual({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-amz-tagging': 'lifecycle=unattached',
    });
  });

  it('presignJpegUpload is a JPEG presign without cache control', async () => {
    useRealClient();
    const { headers } = await presignJpegUpload('courses/c/image/a.jpg', 5);
    expect(headers).toEqual({
      'Content-Type': 'image/jpeg',
      'x-amz-tagging': 'lifecycle=unattached',
    });
  });

  it('headPublicMediaObject returns undefined for a missing object', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'NotFound' }),
    );
    expect(await headPublicMediaObject('brand/x.png')).toBeUndefined();
  });

  it('bestEffortDetachPublicMediaObject logs and does not throw', async () => {
    send.mockRejectedValue(new Error('boom'));
    const logger = { error: vi.fn() };
    await bestEffortDetachPublicMediaObject(logger as never, 'brand/x.png');
    expect(logger.error).toHaveBeenCalled();
  });
});
