/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import {
  DeleteObjectTaggingCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, resolveBucketName } from './lesson-media-bucket.js';

/**
 * The tag on a public media object nothing points at: an upload not yet
 * saved on its course, or an image since replaced or removed. The bucket's
 * lifecycle rule deletes objects carrying it after a day, so abandoned
 * uploads and retired images clean themselves up. Saving an image removes
 * the tag; replacing or removing it puts the tag back.
 */
export const UNATTACHED_TAG = { Key: 'lifecycle', Value: 'unattached' };

/** UNATTACHED_TAG as an x-amz-tagging header value, for a presigned PUT. */
export const UNATTACHED_TAGGING = `${UNATTACHED_TAG.Key}=${UNATTACHED_TAG.Value}`;

/**
 * Where a course's display image is stored. A new nonce per upload, so each
 * version has its own URL: CloudFront can cache it indefinitely, and a
 * replaced image is never served stale.
 */
export const courseImageKey = (courseId: string, nonce: string): string =>
  `courses/${courseId}/image/${nonce}.jpg`;

/** Whether `key` is one of `courseId`'s image keys, as courseImageKey makes. */
export const isCourseImageKey = (courseId: string, key: string): boolean =>
  new RegExp(`^courses/${courseId}/image/[0-9a-f-]{36}\\.jpg$`).test(key);

/**
 * Where an instructor's profile photo is stored, keyed on their Cognito `sub`.
 * A new nonce per upload, for the same reason as courseImageKey.
 */
export const instructorPhotoKey = (
  instructorId: string,
  nonce: string,
): string => `instructors/${instructorId}/${nonce}.jpg`;

/** Whether `key` is one of `instructorId`'s photo keys, as instructorPhotoKey makes. */
export const isInstructorPhotoKey = (
  instructorId: string,
  key: string,
): boolean =>
  key.startsWith(`instructors/${instructorId}/`) &&
  /^[0-9a-f-]{36}\.jpg$/.test(key.slice(`instructors/${instructorId}/`.length));

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

const resolvePublicMediaBucketName = (): Promise<string> =>
  resolveBucketName('PublicMediaBucket');

/**
 * A presigned PUT of exactly `contentLength` bytes of `contentType` at `key`,
 * arriving tagged unattached (see UNATTACHED_TAG) until it's saved. The type,
 * size, tag and `Cache-Control` (when given) are all signed, so S3 refuses an
 * upload that differs in any of them; `headers` are what the browser must
 * send for that.
 */
export const presignPublicMediaUpload = async ({
  key,
  contentType,
  contentLength,
  cacheControl,
}: {
  key: string;
  contentType: string;
  contentLength: number;
  cacheControl?: string;
}): Promise<{ uploadUrl: string; headers: Record<string, string> }> => {
  const signableHeaders = new Set(['content-type', 'content-length']);
  if (cacheControl) {
    signableHeaders.add('cache-control');
  }
  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: await resolvePublicMediaBucketName(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      CacheControl: cacheControl,
      Tagging: UNATTACHED_TAGGING,
    }),
    {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
      // Left in the query string, S3 ignores the tag, and unsigned, the type
      // and size could be anything.
      unhoistableHeaders: new Set(['x-amz-tagging']),
      signableHeaders,
    },
  );
  return {
    uploadUrl,
    headers: {
      'Content-Type': contentType,
      ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
      'x-amz-tagging': UNATTACHED_TAGGING,
    },
  };
};

/** A presigned PUT for a JPEG: the course image and profile photo upload. */
export const presignJpegUpload = (
  key: string,
  contentLength: number,
): Promise<{ uploadUrl: string; headers: Record<string, string> }> =>
  presignPublicMediaUpload({
    key,
    contentType: 'image/jpeg',
    contentLength,
  });

/** An uploaded object's type and size, or undefined if there's none. */
export const headPublicMediaObject = async (
  key: string,
): Promise<{ contentType?: string; contentLength?: number } | undefined> => {
  try {
    const { ContentType, ContentLength } = await getS3Client().send(
      new HeadObjectCommand({
        Bucket: await resolvePublicMediaBucketName(),
        Key: key,
      }),
    );
    return { contentType: ContentType, contentLength: ContentLength };
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFound') {
      return undefined;
    }
    throw error;
  }
};

/**
 * An uploaded object's bytes, or undefined if there's none. Refuses (throws)
 * a body longer than `maxBytes`, so a caller never buffers more than it
 * means to.
 */
export const getPublicMediaObjectBytes = async (
  key: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> => {
  try {
    const { Body, ContentLength } = await getS3Client().send(
      new GetObjectCommand({
        Bucket: await resolvePublicMediaBucketName(),
        Key: key,
      }),
    );
    if (!Body) {
      return undefined;
    }
    if (ContentLength !== undefined && ContentLength > maxBytes) {
      throw new Error(`Object ${key} is longer than ${maxBytes} bytes`);
    }
    const bytes = await Body.transformToByteArray();
    if (bytes.length > maxBytes) {
      throw new Error(`Object ${key} is longer than ${maxBytes} bytes`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return undefined;
    }
    throw error;
  }
};

/** Keeps an object: removes the tag that would expire it. */
export const attachPublicMediaObject = async (key: string): Promise<void> => {
  await getS3Client().send(
    new DeleteObjectTaggingCommand({
      Bucket: await resolvePublicMediaBucketName(),
      Key: key,
    }),
  );
};

/**
 * Lets an object nothing points at any more expire, after a day. Best-effort:
 * the record that points at an image decides which one is shown, so failing
 * to clean up an old one is logged, never thrown.
 */
export const bestEffortDetachPublicMediaObject = async (
  logger: Logger | undefined,
  key: string,
): Promise<void> => {
  try {
    await getS3Client().send(
      new PutObjectTaggingCommand({
        Bucket: await resolvePublicMediaBucketName(),
        Key: key,
        Tagging: { TagSet: [UNATTACHED_TAG] },
      }),
    );
  } catch (error) {
    logger?.error('Failed to detach a public media object', { error, key });
  }
};
