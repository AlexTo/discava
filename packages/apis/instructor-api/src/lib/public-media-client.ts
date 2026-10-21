/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  DeleteObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  UNATTACHED_TAG,
  UNATTACHED_TAGGING,
} from '@discava/common-server-utils/public-media';
import { resolveAppConfigValue } from './runtime-config.js';
import { getS3Client } from './s3-client.js';

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

const resolvePublicMediaBucketName = async (): Promise<string> =>
  (
    await resolveAppConfigValue<{ bucketName: string }>(
      's3',
      'PublicMediaBucket',
    )
  ).bucketName;

/**
 * A presigned PUT for a JPEG of exactly `contentLength` bytes at `key`,
 * arriving tagged unattached (see UNATTACHED_TAG) until it's saved. The type,
 * size and tag are all signed, so S3 refuses an upload that differs in any of
 * them; `headers` are what the browser must send for that.
 */
export const presignJpegUpload = async (
  key: string,
  contentLength: number,
): Promise<{ uploadUrl: string; headers: Record<string, string> }> => {
  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: await resolvePublicMediaBucketName(),
      Key: key,
      ContentType: 'image/jpeg',
      ContentLength: contentLength,
      Tagging: UNATTACHED_TAGGING,
    }),
    {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
      // Left in the query string, S3 ignores the tag, and unsigned, the type
      // and size could be anything.
      unhoistableHeaders: new Set(['x-amz-tagging']),
      signableHeaders: new Set(['content-type', 'content-length']),
    },
  );
  return {
    uploadUrl,
    headers: {
      'Content-Type': 'image/jpeg',
      'x-amz-tagging': UNATTACHED_TAGGING,
    },
  };
};

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
 * the course record is what decides which image is shown, so failing to
 * clean up an old one is logged, never thrown.
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
