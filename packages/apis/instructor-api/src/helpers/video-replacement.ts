/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  type CoreTable,
  isConditionalCheckFailed,
  TRANSCODE_PENDING_ATTRIBUTES,
  transcodePendingFrom,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { writeUnderActiveAncestors } from './ancestor-writes.js';
import {
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  submitTranscodeJob,
} from './mediaconvert-client.js';
import { bestEffortDeleteContentItemVideos } from './s3-client.js';

// The stages of replacing (or just editing) a video content item, called in
// order by updateContentItemVideo.

export interface VideoKey {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
}

export type StoredVideoItem = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['contentItem']['get']>['go']>
  >['data']
>;

export interface VideoMetadata {
  title?: string;
  description?: string;
  mimeType?: string;
  durationSeconds?: number;
}

interface VideoWrite {
  coreTable: CoreTable;
  videoKey: VideoKey;
  existing: StoredVideoItem;
}

// A write below lost its race: another replace, an edit, a delete or an
// archive landed since the read before it.
const throwModifiedConflict = (): never => {
  throw new TRPCError({
    code: 'CONFLICT',
    message: 'Content item was modified by another request; please retry',
  });
};

const metadataSet = ({
  title,
  description,
  mimeType,
  durationSeconds,
}: VideoMetadata) => ({
  ...(title !== undefined && { title }),
  ...(description !== undefined && { description }),
  ...(mimeType !== undefined && { mimeType }),
  ...(durationSeconds !== undefined && { durationSeconds }),
});

export const hasMetadata = (metadata: VideoMetadata) =>
  Object.keys(metadataSet(metadata)).length > 0;

export const requireObjectKeyInLesson = (
  { courseId, moduleId, lessonId }: VideoKey,
  objectKey: string,
) => {
  // The key must be scoped to this lesson, so a caller can't point the
  // record at another lesson's object. It isn't required to contain this
  // contentItemId: createContentItemVideoUploadUrl only reuses the id when
  // told the upload is a replacement.
  if (
    !objectKey.startsWith(
      `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/`,
    )
  ) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'objectKey does not match this lesson',
    });
  }
};

// A caller retrying this exact mutation (e.g. after a client-side timeout)
// would otherwise cancel the job the first call started and resubmit. When
// the objectKey and the raw upload's ETag both match what's mid-transcode,
// the video hasn't changed, so the transcode is left alone; title,
// description etc. may still differ and are still applied.
export const isRetryOfInFlightSubmission = (
  existing: StoredVideoItem,
  objectKey: string,
  objectETag: string,
) =>
  existing.status === 'pending' &&
  existing.s3Key === objectKey &&
  existing.mediaConvertJobId !== undefined &&
  existing.rawObjectETag === objectETag;

// A retry after a crash between submitTranscodeJob and stamping
// mediaConvertJobId finds the same pending item and key with no job id.
// Reusing its nonce lets submitTranscodeJob's ClientRequestToken reconnect to
// the job already created. Anything else is a new submission with a fresh
// nonce.
export const pickSubmissionNonce = (
  existing: StoredVideoItem,
  objectKey: string,
) =>
  existing.status === 'pending' &&
  existing.s3Key === objectKey &&
  existing.mediaConvertJobId === undefined &&
  existing.submissionNonce
    ? existing.submissionNonce
    : randomUUID();

export const patchInFlightMetadata = async (
  { coreTable, videoKey, existing }: VideoWrite,
  metadata: VideoMetadata,
) => {
  const metadataUpdates = metadataSet(metadata);
  // Conditioned on the record still being this submission's (a transcode
  // completion never changes submissionNonce) and nothing being archived.
  // Losing that means a concurrent replacement or delete won: CONFLICT.
  await writeUnderActiveAncestors(
    coreTable,
    videoKey,
    (entities) => [
      entities.contentItem
        .patch(videoKey)
        .set(metadataUpdates)
        .where(
          (attr, op) =>
            `${op.eq(attr.submissionNonce, existing.submissionNonce!)} AND ${op.notExists(attr.archivedAt)}`,
        )
        .commit(),
    ],
    throwModifiedConflict,
  );
  // Transactions don't return the written attributes.
  return (await coreTable.entities.contentItem.get(videoKey).go()).data;
};

export const patchReplacement = async (
  { coreTable, videoKey, existing }: VideoWrite,
  metadata: VideoMetadata,
  objectKey: string,
  submissionNonce: string,
) => {
  const { title, description, mimeType, durationSeconds } = metadata;
  // Also conditioned, in the same transaction, on the module and lesson
  // still being active and the item still not archived, so an archive
  // landing after the checks above can't be replaced past.
  await writeUnderActiveAncestors(
    coreTable,
    videoKey,
    (entities) => [
      entities.contentItem
        .patch(videoKey)
        .set({
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          // Replacing the file invalidates whatever transcode already
          // ran against the old one -- the new object needs to go
          // through it again before it's playable.
          s3Key: objectKey,
          status: 'pending',
          submissionNonce,
          // Watched by the transcode reconciler until it's ready or
          // failed; restarts the clock for a replacement of one pending.
          ...transcodePendingFrom(new Date()),
          // Students keep playing the version being replaced until this
          // one is ready (#209): a ready video becomes the previous
          // version. Replacing a replacement still in flight keeps the
          // previous version it already had.
          ...(existing.status === 'ready' &&
            existing.s3Key && { previousS3Key: existing.s3Key }),
          ...(mimeType !== undefined && { mimeType }),
          ...(durationSeconds !== undefined && { durationSeconds }),
        })
        // Cleared so an undefined mediaConvertJobId means no job is stamped
        // for this submission yet: pickSubmissionNonce relies on that to
        // reconnect a crashed retry instead of submitting a duplicate.
        .remove(['mediaConvertJobId'])
        // Fails if another replace landed since the read, which would
        // otherwise submit a second job for the same item (#123). A
        // metadata-only edit never changes these fields. status and s3Key
        // can read the same on both sides of a race, so submissionNonce is
        // compared too when the item has one.
        .where((attr, op) => {
          const condition = `${op.eq(attr.status, existing.status)} AND ${op.eq(attr.s3Key, existing.s3Key!)}`;
          const owned = existing.submissionNonce
            ? `${condition} AND ${op.eq(attr.submissionNonce, existing.submissionNonce)}`
            : condition;
          return `${owned} AND ${op.notExists(attr.archivedAt)}`;
        })
        .commit(),
    ],
    throwModifiedConflict,
  );
};

export const patchMetadata = async (
  { coreTable, videoKey }: VideoWrite,
  metadata: VideoMetadata,
) => {
  await writeUnderActiveAncestors(
    coreTable,
    videoKey,
    (entities) => [
      entities.contentItem
        .patch(videoKey)
        .set(metadataSet(metadata))
        .where((attr, op) => op.notExists(attr.archivedAt))
        .commit(),
    ],
    throwModifiedConflict,
  );
};

export const readVideoItem = async (coreTable: CoreTable, videoKey: VideoKey) =>
  // Transactions don't return the written attributes.
  (await coreTable.entities.contentItem.get(videoKey).go()).data;

export const cancelAndResubmit = async (
  { coreTable, videoKey, existing }: VideoWrite,
  logger: Logger | undefined,
  objectKey: string,
  objectETag: string,
  submissionNonce: string,
) => {
  const { courseId, moduleId, lessonId, contentItemId } = videoKey;
  // Called only after patchReplacement landed, so `existing` was current:
  // had the previous job finished in between, the patch's condition would
  // have thrown CONFLICT, and this never cleans up output the record uses.
  await bestEffortCancelTranscodeJobs(logger, [existing]);

  // Best-effort: the patch above already orphaned the old raw upload of
  // a replacement still in flight (or failed), regardless of whether the
  // new transcode job below ever successfully starts, so this doesn't
  // wait on that outcome. A ready video isn't deleted: it's now the
  // previous version students play, retired by transcode-complete once
  // this replacement is ready.
  if (
    existing.status !== 'ready' &&
    objectKey !== existing.s3Key &&
    existing.s3Key
  ) {
    await bestEffortDeleteContentItemVideos(logger, [existing]);
  }

  let mediaConvertJobId: string;
  try {
    // Submitted only after the record is patched, so the completion
    // callback can't race ahead of it.
    mediaConvertJobId = await submitTranscodeJob({
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      objectKey,
      submissionNonce: submissionNonce!,
    });
  } catch (error) {
    // Submission failed after the record moved to the new upload and the
    // previous job was canceled, so there's nothing to restore: mark it
    // failed, as a MediaConvert error would. Conditioned on submissionNonce,
    // so a concurrent replacement that superseded this one is untouched.
    await coreTable.entities.contentItem
      .patch({ courseId, moduleId, lessonId, contentItemId })
      .set({ status: 'failed' })
      .remove([...TRANSCODE_PENDING_ATTRIBUTES])
      .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce!))
      .go()
      .catch((patchError: unknown) => {
        logger?.error(
          'Failed to mark content item failed after transcode submission error',
          {
            error: patchError,
            courseId,
            moduleId,
            lessonId,
            contentItemId,
          },
        );
      });
    throw error;
  }

  try {
    // mediaConvertJobId lets transcode-complete.ts ignore a superseded
    // job's completion; rawObjectETag lets a retry of this submission be
    // told from a real replacement. Conditioned on submissionNonce so it
    // can't repoint a concurrent replacement's record at this job.
    await coreTable.entities.contentItem
      .patch({ courseId, moduleId, lessonId, contentItemId })
      .set({ mediaConvertJobId, rawObjectETag: objectETag })
      .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce!))
      .go();
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // A concurrent replacement took the record over, so nothing points
      // at this attempt's job and nothing else will cancel or clean it up.
      await bestEffortCancelTranscodeJob(logger, {
        jobId: mediaConvertJobId,
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        submissionNonce: submissionNonce!,
      });
    } else {
      // The job is running, so marking the record failed would orphan it.
      // The stored submissionNonce lets a retry reconnect via
      // ClientRequestToken, and transcode-complete.ts's nonce-conditioned
      // patch reconciles the record when it finishes.
      logger?.error(
        'Failed to stamp mediaConvertJobId after transcode submission',
        {
          error,
          courseId,
          moduleId,
          lessonId,
          contentItemId,
          mediaConvertJobId,
        },
      );
    }
  }
};
