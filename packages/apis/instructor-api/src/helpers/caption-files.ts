/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  getS3Client,
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';

/** The bytes of an upload in the upload bucket. */
export const readCaptionUpload = async (
  objectKey: string,
): Promise<Uint8Array> => {
  const { Body } = await getS3Client().send(
    new GetObjectCommand({
      Bucket: await resolveLessonMediaUploadBucketName(),
      Key: objectKey,
    }),
  );
  if (!Body) {
    throw new Error(`Caption upload ${objectKey} has no body`);
  }
  return Body.transformToByteArray();
};

/** Writes validated caption bytes to the lesson media bucket as `text/vtt`. */
export const putCaptionFile = async (
  key: string,
  bytes: Uint8Array,
): Promise<void> => {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: await resolveLessonMediaBucketName(),
      Key: key,
      Body: bytes,
      ContentType: 'text/vtt',
    }),
  );
};

/** Deletes a caption file from the lesson media bucket; failures are logged. */
export const bestEffortDeleteCaptionFile = async (
  logger: Logger | undefined,
  key: string,
): Promise<void> => {
  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: await resolveLessonMediaBucketName(),
        Key: key,
      }),
    );
  } catch (error) {
    logger?.error('Failed to delete a caption file', { error, key });
  }
};

/** Deletes an upload from the upload bucket; failures are logged. */
export const bestEffortDeleteCaptionUpload = async (
  logger: Logger | undefined,
  key: string,
): Promise<void> => {
  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: await resolveLessonMediaUploadBucketName(),
        Key: key,
      }),
    );
  } catch (error) {
    logger?.error('Failed to delete a caption upload', { error, key });
  }
};
