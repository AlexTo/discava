/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from '@aws-lambda-powertools/logger';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { scheduleTranscodeCleanup } from '@discava/common-server-utils/cleanup-scheduler';
import {
  deleteObjectsInBatches,
  getS3Client,
  listAllObjectKeys,
  resolveLessonMediaBucketName,
  resolveLessonMediaUploadBucketName,
} from '@discava/common-server-utils/lesson-media-bucket';
import {
  manifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';

/**
 * A raw video upload's ETag if it exists in LessonMediaUploadBucket, else
 * undefined. The objectKey comes from the instructor with no proof the
 * presigned PUT completed, so this stops a transcode job and record being
 * made for nothing. The ETag fingerprints the content: video procedures store
 * it as `rawObjectETag` to tell a retry of the same upload from a new file
 * written to the same key.
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

/**
 * Best-effort cleans up video content items' S3 objects (one for a
 * delete/replace, several for a lesson/module cascade). Failures are logged,
 * never thrown: the DynamoDB record decides whether content exists.
 *
 * By `status`:
 * - `'ready'`: `s3Key` is its HLS manifest in LessonMediaBucket, beside
 *   untracked segments, so the whole `.../<contentItemId>/<submissionNonce>/`
 *   prefix goes, through a delayed scheduleTranscodeCleanup rather than an
 *   inline paginated delete. A ready item with no `submissionNonce` has no
 *   scoped prefix, so its content-item folder is deleted inline.
 * - anything else: `s3Key` is the single raw upload in
 *   LessonMediaUploadBucket, deleted inline.
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
 * isn't cut off. A previous key with no nonce in its path shares its folder
 * with every other version, so it's left rather than risk them.
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

/**
 * Best-effort deletes every raw upload of a course's preview video (the
 * preview record keeps no raw key, and the transcode pipeline deletes one
 * itself once its job ends, so what is left is an abandoned or in-flight
 * upload). Failures are logged, never thrown.
 */
export const bestEffortDeletePreviewUploads = async (
  logger: Logger | undefined,
  courseId: string,
): Promise<void> => {
  try {
    const bucket = await resolveLessonMediaUploadBucketName();
    const keys = await listAllObjectKeys(
      logger,
      bucket,
      `courses/${courseId}/preview/uploads/`,
    );
    if (keys.length > 0) {
      await deleteObjectsInBatches(logger, bucket, keys);
    }
  } catch (error) {
    logger?.error('Failed to delete preview uploads', { error, courseId });
  }
};
