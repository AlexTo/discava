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
import { writeUnderActiveAncestors } from '../lib/course-lifecycle.js';
import {
  bestEffortCancelTranscodeJob,
  bestEffortCancelTranscodeJobs,
  submitTranscodeJob,
} from '../lib/mediaconvert-client.js';
import { bestEffortDeleteContentItemVideos } from '../lib/s3-client.js';

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
  // Replacing the underlying video: the object key must at least be
  // scoped to this lesson, so a caller can't point the record at an
  // object outside its lesson's prefix (e.g. another lesson's video).
  // createContentItemVideoUploadUrl reuses this contentItemId in the key
  // when told it's a replacement, but doesn't have to be -- a caller
  // could still supply an unrelated key from within this lesson, so this
  // check doesn't require an exact contentItemId match.
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

// A caller retrying this exact mutation (e.g. after a client-side
// timeout, even though the original call actually succeeded) would
// otherwise cancel the job that submission started and resubmit a
// redundant one -- interrupting work that was already proceeding
// correctly. objectKey alone can't detect this (it's deterministic
// from contentItemId + extension, so it stays the same across a
// genuine replacement too), but objectKey *and* the raw upload's
// content both matching what's already mid-transcode means nothing
// about the *video* has changed since that submission, so the
// transcode itself is left alone. That says nothing about the rest
// of the mutation, though -- title/description/etc can still differ
// from what's on the record (e.g. the caller edited them after the
// first, still-in-flight attempt), and those still need to land.
export const isRetryOfInFlightSubmission = (
  existing: StoredVideoItem,
  objectKey: string,
  objectETag: string,
) =>
  existing.status === 'pending' &&
  existing.s3Key === objectKey &&
  existing.mediaConvertJobId !== undefined &&
  existing.rawObjectETag === objectETag;

// A crashed retry (submitTranscodeJob succeeded, but the process
// died before the follow-up patch below could stamp mediaConvertJobId
// onto the record) targets the exact same still-pending replacement
// this record already has in flight, just without a job id recorded
// yet -- status/s3Key already prove that, durably, regardless of how
// long ago the crash happened. Reusing its nonce lets
// submitTranscodeJob's ClientRequestToken reconnect to whatever job
// that attempt already created instead of starting a duplicate. Any
// other case -- the content actually changed, the key differs, or
// the item wasn't pending at all -- is a genuinely new submission
// and gets a fresh nonce that can never collide with anything.
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
  // Same ownership check as every other write in this file -- proves
  // the record is still genuinely this exact submission's before
  // applying an edit that has nothing to do with the transcode dedup
  // above -- plus the module, lesson and item still not archived.
  // Losing ownership means a concurrent replacement or delete has
  // already superseded this record since it was read above (an
  // ordinary transcode completion never touches submissionNonce).
  // Reporting success with the earlier snapshot would be wrong: the
  // caller's edit was rejected, not applied, so it's the same CONFLICT
  // the replacement branch below throws for the same kind of race.
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
        // Clearing mediaConvertJobId here (rather than leaving whatever
        // job, if any, the video being replaced previously had) makes it
        // an unambiguous signal for a future read of this record: still
        // undefined means no job has been stamped for *this* submission
        // attempt yet. Without this, a retry after a crash between
        // submitTranscodeJob succeeding and the follow-up stamp below
        // would see a defined-but-stale id here, fail the crash-gap
        // nonce-reuse check above, and submit a duplicate job instead of
        // reconnecting to the one that attempt already created. A
        // no-op when there was nothing to clear (a fresh item, or a
        // retry already resuming this same attempt).
        .remove(['mediaConvertJobId'])
        // Guards against a second updateContentItemVideo replace racing
        // this one: if status/s3Key/submissionNonce have changed since
        // the .get() above, another replace already landed first, and
        // proceeding here would submit a second job writing to the same
        // S3 destination as that one (#123). A concurrent metadata-only
        // edit never touches these fields, so it can never trip this
        // check -- only two concurrent replacements can. submissionNonce
        // is included alongside status/s3Key because objectKey is
        // deterministic from contentItemId + extension: two concurrent
        // same-extension replacements of an already-pending item can
        // read identical status/s3Key values on both sides of the race,
        // so those two alone wouldn't always catch it; submissionNonce is
        // freshly randomized per call and can never coincidentally match.
        // Older records from before submissionNonce existed have nothing
        // to compare, so the check falls back to status/s3Key only for
        // them, same as it always has.
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
  // Only reachable once the patch above has actually landed -- this
  // request's view of the record it just replaced is now provably
  // current, not stale. Canceling (and scheduling cleanup for) the
  // previous job here, rather than before the patch, matters
  // specifically when that job already finished for real in the
  // window between this request's initial .get() and now: the patch's
  // own status/s3Key/submissionNonce condition would already have
  // caught that (the row no longer matches what this request read)
  // and thrown CONFLICT above, so a job scheduleTranscodeCleanup would
  // otherwise queue for deletion is never a job whose output is still
  // the record's own current, legitimate content.
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
    // Submitted only after the patch above has landed -- see the same
    // note in createContentItemVideo.
    mediaConvertJobId = await submitTranscodeJob({
      courseId,
      moduleId,
      lessonId,
      contentItemId,
      objectKey,
      submissionNonce: submissionNonce!,
    });
  } catch (error) {
    // Job submission itself failed -- the record was already patched
    // to point at the new upload, and any job for the previous video
    // has already been canceled above too, so there's no working
    // state left to restore. Mark it failed, the same terminal state a
    // genuine MediaConvert ERROR would produce, so the instructor gets
    // an accurate signal instead of an indefinite "processing" spinner.
    // Conditioned on submissionNonce still being this exact attempt's:
    // a second concurrent replacement could have already superseded
    // this record with its own nonce/job while this attempt was still
    // waiting on submitTranscodeJob, and this attempt's own failure
    // has nothing to do with that newer, legitimate replacement.
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
    // Lets transcode-complete.ts recognize a stale completion event
    // from a job a later replacement has since superseded.
    // rawObjectETag lets a later retry of this exact submission be
    // told apart from a genuine subsequent replacement. Conditioned on
    // submissionNonce still being this exact attempt's, for the same
    // reason as the mark-failed patch above -- a concurrent
    // replacement may have already moved the record onto its own
    // nonce/job, and this stamp landing anyway would silently
    // repoint mediaConvertJobId/rawObjectETag at this attempt's job
    // while leaving that replacement's own s3Key/status in place.
    await coreTable.entities.contentItem
      .patch({ courseId, moduleId, lessonId, contentItemId })
      .set({ mediaConvertJobId, rawObjectETag: objectETag })
      .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce!))
      .go();
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Lost ownership, not a transient failure: a concurrent
      // replacement already moved this record onto its own nonce, so
      // this attempt's job has nothing left pointing at it and needs
      // its own cleanup -- otherwise nothing else will ever cancel or
      // clean it up.
      await bestEffortCancelTranscodeJob(logger, {
        jobId: mediaConvertJobId,
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        submissionNonce: submissionNonce!,
      });
    } else {
      // The job itself is real and already running regardless of
      // whether this stamp lands -- marking the record failed here
      // would orphan it. submissionNonce is already durable from the
      // patch above, so a later retry's crash-gap check reconnects to
      // this exact job via ClientRequestToken, and
      // transcode-complete.ts's own nonce-conditioned patch
      // reconciles the record once the job actually finishes,
      // regardless of whether this stamp ever lands.
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
