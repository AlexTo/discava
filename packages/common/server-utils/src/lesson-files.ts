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
import {
  deleteObjectsInBatches,
  getS3Client,
  listAllObjectKeys,
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} from './lesson-media-bucket.js';

// What a file item may be (#102), by extension: documents, spreadsheets,
// slides, plain text and images, and zip archives. Not HTML or anything
// executable: files are served from the lesson media domain. The portal's
// file picker offers the same list.
export const LESSON_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
};

export const LESSON_FILE_MAX_BYTES = 100 * 1024 * 1024;

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
export const copyLessonFileUpload = (
  objectKey: string,
  details: { contentType: string; fileName: string },
): Promise<void> => copyLessonFileUploadTo(objectKey, objectKey, details);

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

// Student submissions (#102) keep the same layout under the item's own
// `submissions/<userId>/` folder: the upload bucket holds
// `<uploadId>/<name>` and the lesson media bucket `<attemptId>/<name>`, where
// the attempt id is made per submit request, so a request only ever writes
// and deletes its own folder.

type ItemKey = {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
};

// A student's own folder under an item: every submission file is below it.
export const submissionUserPrefix = (key: ItemKey, userId: string) =>
  `${itemPrefix(key)}submissions/${userId}/`;

// The key an upload issued by assignment.uploadUrl has, in the upload bucket.
export const submissionUploadKey = (
  key: ItemKey,
  userId: string,
  uploadId: string,
  fileName: string,
) =>
  `${submissionUserPrefix(key, userId)}${uploadId}/${storedFileName(fileName)}`;

// The key a submitted file is copied to, in the lesson media bucket.
export const submissionFileKey = (
  key: ItemKey,
  userId: string,
  attemptId: string,
  fileName: string,
) =>
  `${submissionUserPrefix(key, userId)}${attemptId}/${storedFileName(fileName)}`;

// The cleanup handler's folder segment for one attempt's folder.
export const submissionFolderNonce = (userId: string, attemptId: string) =>
  `submissions/${userId}/${attemptId}`;

// The folder (with a trailing slash) a submission file's key lives in, or
// undefined for a key outside a student's submission folders.
export const submissionFolderOf = (
  objectKey: string,
  key: ItemKey,
  userId: string,
): string | undefined => {
  const prefix = submissionUserPrefix(key, userId);
  if (!objectKey.startsWith(prefix)) {
    return undefined;
  }
  const match = objectKey
    .slice(prefix.length)
    .match(/^([^/]+)\/[A-Za-z0-9._-]+$/);
  return match ? `${prefix}${match[1]}/` : undefined;
};

// Whether `objectKey` is one assignment.uploadUrl issued for this item, this
// student and this file name: the key is checked against ids the caller
// already has, never trusted to say which item or student it's for.
export const isSubmissionUploadKey = (
  objectKey: string,
  key: ItemKey,
  userId: string,
  fileName: string,
): boolean => {
  const prefix = submissionUserPrefix(key, userId);
  if (!objectKey.startsWith(prefix)) {
    return false;
  }
  const match = objectKey
    .slice(prefix.length)
    .match(/^([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/);
  return match !== null && match[2] === storedFileName(fileName);
};

// Copies one upload into the lesson media bucket under `targetKey`, set to
// download under its original name. As copyLessonFileUpload, for a target key
// that isn't the upload's own.
export const copyLessonFileUploadTo = async (
  uploadKey: string,
  targetKey: string,
  { contentType, fileName }: { contentType: string; fileName: string },
): Promise<void> => {
  const uploadBucket = await resolveLessonMediaUploadBucketName();
  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: await resolveLessonMediaBucketName(),
      Key: targetKey,
      CopySource: `${uploadBucket}/${uploadKey}`,
      MetadataDirective: 'REPLACE',
      ContentType: contentType,
      ContentDisposition: contentDisposition(fileName),
    }),
  );
};

// Removes everything under one folder of the lesson media bucket (a
// submit request's folder that no record ended up pointing at). Best-effort,
// like bestEffortDeleteLessonFileCopy: failures are only logged.
export const deleteLessonMediaFolder = async (
  logger: Logger | undefined,
  prefix: string,
): Promise<void> => {
  try {
    const bucket = await resolveLessonMediaBucketName();
    const keys = await listAllObjectKeys(logger, bucket, prefix);
    await deleteObjectsInBatches(logger, bucket, keys);
  } catch (error) {
    logger?.error('Failed to delete a lesson media folder', {
      error,
      prefix,
    });
  }
};
