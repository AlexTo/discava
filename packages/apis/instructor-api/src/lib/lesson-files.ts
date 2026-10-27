/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { LESSON_FILE_TYPES } from '../schema/index.js';
import {
  getS3Client,
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} from './s3-client.js';

// File items (#102): a file is uploaded to the lesson media upload bucket,
// whose lifecycle rule expires anything left there, then copied into the
// lesson media bucket when the item is saved. It keeps the same key in both:
// courses/<c>/modules/<m>/lessons/<l>/content-items/<id>/<uploadId>/<name>,
// the per-version folder a video's output uses, so deleting or replacing it
// retires the folder the same way.

const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

const extensionOf = (fileName: string) =>
  fileName.includes('.')
    ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
    : '';

// The content type a file name's extension allows, if it's allowed at all.
export const lessonFileType = (fileName: string): string | undefined =>
  LESSON_FILE_TYPES[extensionOf(fileName)];

// The name a file is stored under: its own, in characters that are safe in
// any URL, keeping the extension. Downloads are still saved under the
// original name (see contentDisposition).
export const storedFileName = (fileName: string): string => {
  const extension = extensionOf(fileName);
  const base = fileName
    .slice(0, extension ? -(extension.length + 1) : undefined)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return `${base || 'file'}.${extension}`;
};

const itemPrefix = (key: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}) =>
  `courses/${key.courseId}/modules/${key.moduleId}/lessons/${key.lessonId}/content-items/${key.contentItemId}/`;

export const lessonFileKey = (
  key: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    contentItemId: string;
  },
  uploadId: string,
  fileName: string,
) => `${itemPrefix(key)}${uploadId}/${storedFileName(fileName)}`;

// The upload id in a key createContentItemFileUploadUrl issued for this item,
// or undefined for any other key: the key is checked against the ids the
// caller already has, never trusted to say which item it's for.
export const lessonFileUploadId = (
  objectKey: string,
  key: {
    courseId: string;
    moduleId: string;
    lessonId: string;
    contentItemId: string;
  },
): string | undefined => {
  const prefix = itemPrefix(key);
  if (!objectKey.startsWith(prefix)) {
    return undefined;
  }
  const match = objectKey
    .slice(prefix.length)
    .match(/^([0-9a-f-]{36})\/[A-Za-z0-9._-]+$/);
  return match?.[1];
};

// A presigned PUT for the upload, holding it to `contentType` and exactly
// `contentLength` bytes.
export const presignLessonFileUpload = async (
  objectKey: string,
  contentType: string,
  contentLength: number,
): Promise<{ uploadUrl: string; headers: Record<string, string> }> => ({
  uploadUrl: await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: await resolveLessonMediaUploadBucketName(),
      Key: objectKey,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length']),
    },
  ),
  headers: { 'Content-Type': contentType },
});

// What's at `objectKey` in the upload bucket, if anything.
export const headLessonFileUpload = async (
  objectKey: string,
): Promise<{ contentType?: string; contentLength?: number } | undefined> => {
  try {
    const { ContentType, ContentLength } = await getS3Client().send(
      new HeadObjectCommand({
        Bucket: await resolveLessonMediaUploadBucketName(),
        Key: objectKey,
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

// Saves a download under the name it was uploaded with: an ASCII fallback for
// old browsers, and the exact name (RFC 6266/5987) for the rest.
export const contentDisposition = (fileName: string) =>
  `attachment; filename="${fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

// Copies an upload into the lesson media bucket at the same key, set to
// download (rather than open) under its original name.
export const copyLessonFileUpload = async (
  objectKey: string,
  { contentType, fileName }: { contentType: string; fileName: string },
): Promise<void> => {
  const uploadBucket = await resolveLessonMediaUploadBucketName();
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: await resolveLessonMediaBucketName(),
      Key: objectKey,
      CopySource: `${uploadBucket}/${objectKey}`,
      MetadataDirective: 'REPLACE',
      ContentType: contentType,
      ContentDisposition: contentDisposition(fileName),
    }),
  );
};

// Removes a copy no item ended up pointing at (its save failed after the
// copy). Best-effort: the lesson media bucket has no lifecycle rule, so a
// failure leaves an orphan, which is only logged.
export const bestEffortDeleteLessonFileCopy = async (
  logger: Logger | undefined,
  objectKey: string,
): Promise<void> => {
  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: await resolveLessonMediaBucketName(),
        Key: objectKey,
      }),
    );
  } catch (error) {
    logger?.error('Failed to delete an unused lesson file copy', {
      error,
      objectKey,
    });
  }
};
