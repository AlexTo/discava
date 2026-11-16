/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { captionKey } from '@discava/common-server-utils/captions';
import { resolveLessonMediaBucketName } from '@discava/common-server-utils/lesson-media-bucket';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import { manifestNonce } from '@discava/common-server-utils/media-keys';
import { captionLabel } from '@discava/common-web-utils/caption-languages';
import {
  applyCaptionChange,
  CaptionTrackError,
  captionWriteCondition,
  isConditionalCheckFailed,
} from '@discava/core-table';
import { stillPending } from '../lib/caption-conditions.js';
import { getCoreTable } from './transcode-outcome.js';

// S3Mock in local dev (#137).
const s3Client = new S3Client(s3ClientConfig());

// The language automatic captions are made in (the job's LanguageCode default).
const AUTO_CAPTION_LANGUAGE = 'en-US';

/** How a Transcribe job ended, and the video version it was for. */
export interface TranscribeOutcome {
  jobName: string;
  // Transcribe's job status: COMPLETED and FAILED are acted on, anything
  // else is ignored.
  status: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  // The version (manifest nonce) the job captioned.
  nonce: string;
  // The WebVTT Transcribe wrote, in the version's scratch folder.
  vttKey?: string;
}

// Deleting the scratch objects only costs a stray file when it fails (they
// sit under the item's folder, which deleting the item removes), so it never
// fails the outcome.
const deleteScratch = async (
  logger: Logger,
  bucket: string,
  vttKey: string,
): Promise<void> => {
  const jsonKey = vttKey.replace(/\.vtt$/, '.json');
  for (const Key of new Set([vttKey, jsonKey])) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    } catch (error) {
      logger.error('Failed to delete a Transcribe scratch object', {
        error,
        key: Key,
      });
    }
  }
};

/**
 * Applies a finished Transcribe job to its video: on COMPLETED the WebVTT
 * becomes the version's default `auto` track and captionsStatus `ready`, on
 * FAILED the status becomes `failed`. Every write is conditioned on the item
 * still playing the job's version and still waiting for its captions, so
 * applying an outcome twice, after a replacement or after the item was
 * deleted is a logged no-op that never touches another version's tracks. An
 * instructor's upload in the same language is never overwritten (the status
 * still becomes `ready`). Transient errors are rethrown for EventBridge to
 * retry, as applyTranscodeOutcome does.
 */
export const applyTranscribeOutcome = async (
  logger: Logger,
  outcome: TranscribeOutcome,
): Promise<void> => {
  const { jobName, courseId, moduleId, lessonId, contentItemId, nonce } =
    outcome;
  const ref = { courseId, moduleId, lessonId, contentItemId };
  const context = { jobName, nonce, ...ref };
  const coreTable = await getCoreTable();

  if (outcome.status !== 'COMPLETED' && outcome.status !== 'FAILED') {
    logger.info('Ignoring Transcribe job state change', {
      status: outcome.status,
    });
    return;
  }

  const bucket = await resolveLessonMediaBucketName();
  const scratch = outcome.vttKey;

  if (outcome.status === 'FAILED') {
    try {
      await coreTable.entities.contentItem
        .patch(ref)
        .set({ captionsStatus: 'failed' })
        .remove(['captionsPendingSince'])
        .where(stillPending(nonce))
        .go();
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        logger.error('Failed to mark captions failed', { error, ...context });
        throw error;
      }
      logger.info('Video no longer waiting for these captions', context);
    }
    return;
  }

  for (let attempt = 1; ; attempt++) {
    const { data: item } = await coreTable.entities.contentItem.get(ref).go();
    if (
      !item ||
      item.status !== 'ready' ||
      manifestNonce(item.s3Key ?? '') !== nonce ||
      item.captionsStatus !== 'pending'
    ) {
      // Deleted, replaced since, or already applied (the scratch files of a
      // first application are gone, so a second one has nothing to copy).
      logger.info('Video no longer waiting for these captions', context);
      if (scratch && item && manifestNonce(item.s3Key ?? '') !== nonce) {
        await deleteScratch(logger, bucket, scratch);
      }
      return;
    }

    const rev = item.captionTracksRev ?? 0;
    const trackId = randomUUID();
    const key = captionKey(ref, nonce, trackId);
    let change: ReturnType<typeof applyCaptionChange>;
    try {
      change = applyCaptionChange(
        item.captionTracks,
        {
          type: 'add',
          nonce,
          track: {
            trackId,
            nonce,
            language: AUTO_CAPTION_LANGUAGE,
            label: captionLabel(AUTO_CAPTION_LANGUAGE),
            source: 'auto',
            key,
          },
        },
        { currentNonce: nonce },
      );
    } catch (error) {
      if (!(error instanceof CaptionTrackError)) {
        throw error;
      }
      // Ten tracks already: nothing to add, and captioning is done.
      logger.warn('Left the automatic captions out', {
        code: error.code,
        ...context,
      });
      change = { tracks: item.captionTracks ?? [], dropped: true };
    }

    if (change.dropped) {
      logger.info(
        'An uploaded track already holds the language; kept it',
        context,
      );
      try {
        await coreTable.entities.contentItem
          .patch(ref)
          .set({ captionsStatus: 'ready' })
          .remove(['captionsPendingSince'])
          .where(stillPending(nonce))
          .go();
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          throw error;
        }
        logger.info('Video no longer waiting for these captions', context);
        return;
      }
      if (scratch) {
        await deleteScratch(logger, bucket, scratch);
      }
      return;
    }

    if (!scratch) {
      throw new Error(`Transcribe job ${jobName} wrote no WebVTT file`);
    }
    // Into the version's folder, where its signed cookies reach; copied
    // before the track is written, so a track never points at nothing.
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${scratch}`,
        Key: key,
        ContentType: 'text/vtt',
        MetadataDirective: 'REPLACE',
      }),
    );
    try {
      await coreTable.entities.contentItem
        .patch(ref)
        .set({
          captionTracks: change.tracks,
          captionTracksRev: rev + 1,
          captionsStatus: 'ready',
        })
        .remove(['captionsPendingSince'])
        .where(captionWriteCondition(rev, nonce))
        .go();
    } catch (error) {
      await s3Client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch((deleteError) =>
          logger.error('Failed to delete an unused caption copy', {
            error: deleteError,
            key,
          }),
        );
      if (!isConditionalCheckFailed(error)) {
        logger.error('Failed to add the automatic captions', {
          error,
          ...context,
        });
        throw error;
      }
      if (attempt >= 2) {
        // Lost twice: rethrown so the event is retried, scratch files kept.
        throw error;
      }
      logger.info('Captions changed meanwhile; trying again', context);
      continue;
    }
    await deleteScratch(logger, bucket, scratch);
    return;
  }
};
