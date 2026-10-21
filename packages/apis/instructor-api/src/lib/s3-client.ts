/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  manifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';
import { resolveAppConfigValue } from './runtime-config.js';
import { scheduleTranscodeCleanup } from './transcode-cleanup-scheduler.js';

let _client: S3Client | undefined;

export const getS3Client = (): S3Client => {
  if (!_client) {
    _client = new S3Client({});
  }
  return _client;
};

type S3Config = {
  bucketName: string;
};

const resolveBucketName = async (runtimeConfigKey: string): Promise<string> =>
  (await resolveAppConfigValue<S3Config>('s3', runtimeConfigKey)).bucketName;

export const resolveLessonMediaBucketName = (): Promise<string> =>
  resolveBucketName('LessonMediaBucket');

// The raw, untranscoded upload -- never served directly, see decision log
// in #110. createContentItemVideoUploadUrl targets this bucket instead of
// LessonMediaBucket; createContentItemVideo/updateContentItemVideo submit
// the transcode job that eventually moves the finished object over and
// deletes the raw one (see lib/mediaconvert-client.ts).
export const resolveLessonMediaUploadBucketName = (): Promise<string> =>
  resolveBucketName('LessonMediaUploadBucket');

/**
 * Returns a raw video upload's ETag if it actually exists in
 * LessonMediaUploadBucket, or undefined otherwise.
 * createContentItemVideo/updateContentItemVideo take an instructor-supplied
 * objectKey with no other proof the client's presigned PUT ever completed,
 * so this guards against submitting a transcode job -- and writing a
 * DynamoDB record -- for an object that was never uploaded. The ETag itself
 * is a content fingerprint (mediaconvert-client.ts folds it into the
 * MediaConvert job's idempotency token, since objectKey alone can't tell a
 * retried submission apart from a genuinely different file later
 * overwriting the same key).
 */
export const getVideoUploadETag = async (
  objectKey: string,
): Promise<string | undefined> => {
  const bucket = await resolveLessonMediaUploadBucketName();
  try {
    const { ETag } = await getS3Client().send(
      new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
    return ETag;
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFound') {
      return undefined;
    }
    throw error;
  }
};

export type IDeletableVideoContentItem = {
  status: string;
  s3Key?: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  submissionNonce?: string;
  // The version students still play while a replacement transcodes (#209).
  previousS3Key?: string;
};

// S3 hard caps: ListObjectsV2 returns at most 1,000 keys per page, and
// DeleteObjects accepts at most 1,000 keys per call (a bigger request is
// rejected outright, not partially applied).
const S3_PAGE_SIZE = 1000;

const listAllObjectKeys = async (
  logger: Logger | undefined,
  bucket: string,
  prefix: string,
): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    try {
      const { Contents, IsTruncated, NextContinuationToken } =
        await getS3Client().send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
      for (const object of Contents ?? []) {
        if (object.Key !== undefined) {
          keys.push(object.Key);
        }
      }
      continuationToken = IsTruncated ? NextContinuationToken : undefined;
    } catch (error) {
      logger?.error('Failed to list lesson media objects from S3', {
        error,
        bucket,
        prefix,
      });
      break;
    }
  } while (continuationToken !== undefined);
  return keys;
};

const deleteObjectsInBatches = async (
  logger: Logger | undefined,
  bucket: string,
  keys: readonly string[],
): Promise<void> => {
  for (let i = 0; i < keys.length; i += S3_PAGE_SIZE) {
    const batch = keys.slice(i, i + S3_PAGE_SIZE);
    try {
      const { Errors } = await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      // DeleteObjects can resolve successfully and still fail individual
      // keys -- doesn't throw, so has to be checked explicitly or it's
      // silently lost. Logged, not thrown: this function is best-effort
      // by contract (see bestEffortDeleteContentItemVideos's docstring).
      if (Errors && Errors.length > 0) {
        logger?.error('Failed to delete some lesson media objects from S3', {
          bucket,
          errors: Errors,
        });
      }
    } catch (error) {
      logger?.error('Failed to delete lesson media objects from S3', {
        error,
        bucket,
        keys: batch,
      });
    }
  }
};

/**
 * Best-effort cleans up one or more video content items' underlying S3
 * object(s) -- a single item for a direct delete/replace, or several at
 * once for a lesson/module cascade delete. Failures are logged, never
 * thrown: the DynamoDB record is always the source of truth for whether a
 * piece of content exists, so a failure to clean up here must never fail
 * the caller's mutation.
 *
 * Which bucket holds an item's object(s), and how they're cleaned up,
 * depends on its `status`:
 * - `'ready'`: `s3Key` is its HLS manifest in LessonMediaBucket, alongside
 *   segment files that aren't individually tracked -- the whole
 *   `.../content-items/<contentItemId>/<submissionNonce>/` prefix needs
 *   deleting, which can span many objects. Rather than paginating through
 *   all of them inline (delaying the caller's response for no benefit --
 *   nothing about it needs to happen before responding), this schedules a
 *   delayed cleanup the same way a canceled job's own output is cleaned up
 *   (see scheduleTranscodeCleanup). A `'ready'` item from before
 *   `submissionNonce` existed has no scoped prefix to schedule against --
 *   falls back to the old inline delete for just those, best-effort.
 * - anything else: `s3Key` is still the single raw upload in
 *   LessonMediaUploadBucket -- one object, cheap to delete inline.
 */
export const bestEffortDeleteContentItemVideos = async (
  logger: Logger | undefined,
  contentItems: readonly IDeletableVideoContentItem[],
): Promise<void> => {
  const readyItemsWithNonce = contentItems.filter(
    (item): item is IDeletableVideoContentItem & { submissionNonce: string } =>
      item.status === 'ready' && !!item.s3Key && !!item.submissionNonce,
  );
  const readyItemsWithoutNonce = contentItems.filter(
    (item) => item.status === 'ready' && item.s3Key && !item.submissionNonce,
  );
  const rawKeys = contentItems
    .filter((item) => item.status !== 'ready' && item.s3Key)
    .map((item) => item.s3Key!);

  await Promise.all(
    readyItemsWithNonce.map((item) =>
      scheduleTranscodeCleanup(logger, {
        courseId: item.courseId,
        moduleId: item.moduleId,
        lessonId: item.lessonId,
        contentItemId: item.contentItemId,
        submissionNonce: item.submissionNonce,
      }),
    ),
  );

  if (readyItemsWithoutNonce.length > 0) {
    const bucket = await resolveLessonMediaBucketName();
    const keysToDelete = (
      await Promise.all(
        readyItemsWithoutNonce.map((item) => {
          const prefix = `courses/${item.courseId}/modules/${item.moduleId}/lessons/${item.lessonId}/content-items/${item.contentItemId}/`;
          return listAllObjectKeys(logger, bucket, prefix);
        }),
      )
    ).flat();
    if (keysToDelete.length > 0) {
      await deleteObjectsInBatches(logger, bucket, keysToDelete);
    }
  }

  if (rawKeys.length > 0) {
    const bucket = await resolveLessonMediaUploadBucketName();
    await deleteObjectsInBatches(logger, bucket, rawKeys);
  }
};

/**
 * Schedules deletion of the previous version a video item was keeping
 * playable while it's replaced (#209), for when the item itself is deleted.
 * Kept apart from bestEffortDeleteContentItemVideos, which also cleans up an
 * abandoned replacement's upload while the item still plays its previous
 * version. Waits RETIRED_VERSION_DELAY_MINUTES, so anyone still streaming it
 * isn't cut off. One from before nonces shares its folder with every other
 * version, so it's left rather than risk them.
 */
export const bestEffortRetirePreviousVersions = async (
  logger: Logger | undefined,
  contentItems: readonly IDeletableVideoContentItem[],
): Promise<void> => {
  await Promise.all(
    contentItems.flatMap((item) => {
      const nonce = item.previousS3Key && manifestNonce(item.previousS3Key);
      return nonce
        ? [
            scheduleTranscodeCleanup(
              logger,
              {
                courseId: item.courseId,
                moduleId: item.moduleId,
                lessonId: item.lessonId,
                contentItemId: item.contentItemId,
                submissionNonce: nonce,
              },
              RETIRED_VERSION_DELAY_MINUTES,
            ),
          ]
        : [];
    }),
  );
};
