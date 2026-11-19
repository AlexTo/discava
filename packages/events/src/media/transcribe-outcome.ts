/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { Logger } from '@aws-lambda-powertools/logger';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  captionKey,
  previewCaptionKey,
} from '@discava/common-server-utils/captions';
import { resolveLessonMediaBucketName } from '@discava/common-server-utils/lesson-media-bucket';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import {
  manifestNonce,
  previewManifestNonce,
} from '@discava/common-server-utils/media-keys';
import { captionLabel } from '@discava/common-web-utils/caption-languages';
import {
  applyCaptionChange,
  type CaptionTargetKey,
  CaptionTrackError,
  getCaptionRecord,
  isConditionalCheckFailed,
  writeCaptionsFailed,
  writeCaptionsReady,
  writeCaptionTracks,
} from '@discava/core-table';
import { getCoreTable } from './transcode-outcome.js';

// S3Mock in local dev (#137).
const s3Client = new S3Client(s3ClientConfig());

// The language automatic captions are made in (the job's LanguageCode default).
const AUTO_CAPTION_LANGUAGE = 'en-US';

interface OutcomeBase {
  jobName: string;
  // Transcribe's job status: COMPLETED and FAILED are acted on, anything
  // else is ignored.
  status: string;
  // The version (manifest nonce) the job captioned.
  nonce: string;
  // The WebVTT Transcribe wrote, in the version's scratch folder.
  vttKey?: string;
}

/**
 * How a Transcribe job ended, and the video version it was for: a content
 * item's (no `target`) or a course preview's.
 */
export type TranscribeOutcome = OutcomeBase &
  (
    | {
        target?: 'contentItem';
        courseId: string;
        moduleId: string;
        lessonId: string;
        contentItemId: string;
      }
    | { target: 'coursePreview'; courseId: string }
  );

const WRITE_ACCESS_CHECK_FILE = '.write_access_check_file.temp';

// Whether the WebVTT holds at least one cue: Transcribe writes a file with only
// the header for audio with no speech, or no audio at all.
const hasCues = async (bucket: string, key: string): Promise<boolean> => {
  const { Body } = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return (await Body?.transformToString())?.includes('-->') ?? false;
};

// Deleting the scratch objects only costs a stray file when it fails (they
// sit under the item's folder, which deleting the item removes), so it never
// fails the outcome.
const deleteScratch = async (
  logger: Logger,
  bucket: string,
  vttKey: string,
): Promise<void> => {
  const jsonKey = vttKey.replace(/\.vtt$/, '.json');
  // Transcribe checks it can write to the output folder by creating this
  // empty file, and leaves it there.
  const accessCheckKey = vttKey.replace(/[^/]+$/, WRITE_ACCESS_CHECK_FILE);
  for (const Key of new Set([vttKey, jsonKey, accessCheckKey])) {
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
  const { jobName, nonce } = outcome;
  const isPreview = outcome.target === 'coursePreview';
  const ref: CaptionTargetKey =
    outcome.target === 'coursePreview'
      ? { courseId: outcome.courseId }
      : {
          courseId: outcome.courseId,
          moduleId: outcome.moduleId,
          lessonId: outcome.lessonId,
          contentItemId: outcome.contentItemId,
        };
  const context = { jobName, nonce, ...ref };
  const { entities } = await getCoreTable();
  const versionNonce = (s3Key: string) =>
    isPreview ? previewManifestNonce(s3Key) : manifestNonce(s3Key);

  if (outcome.status !== 'COMPLETED' && outcome.status !== 'FAILED') {
    logger.info('Ignoring Transcribe job state change', {
      status: outcome.status,
    });
    return;
  }

  const bucket = await resolveLessonMediaBucketName();
  const scratch = outcome.vttKey;

  const markFailed = async (): Promise<void> => {
    try {
      await writeCaptionsFailed(entities, ref, nonce);
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        logger.error('Failed to mark captions failed', { error, ...context });
        throw error;
      }
      logger.info('Video no longer waiting for these captions', context);
    }
  };

  if (outcome.status === 'FAILED') {
    await markFailed();
    return;
  }

  for (let attempt = 1; ; attempt++) {
    const item = await getCaptionRecord(entities, ref);
    if (
      !item ||
      item.status !== 'ready' ||
      versionNonce(item.s3Key ?? '') !== nonce ||
      item.captionsStatus !== 'pending'
    ) {
      // Deleted, replaced since, or already applied (the scratch files of a
      // first application are gone, so a second one has nothing to copy).
      logger.info('Video no longer waiting for these captions', context);
      if (scratch && item && versionNonce(item.s3Key ?? '') !== nonce) {
        await deleteScratch(logger, bucket, scratch);
      }
      return;
    }

    const rev = item.captionTracksRev ?? 0;
    const trackId = randomUUID();
    const key =
      'contentItemId' in ref
        ? captionKey(ref, nonce, trackId)
        : previewCaptionKey(ref.courseId, nonce, trackId);
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
        await writeCaptionsReady(entities, ref, nonce);
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
    if (!(await hasCues(bucket, scratch))) {
      // No speech to caption: a track with no cues would only show students
      // an empty captions menu, so it counts as a failure the instructor sees.
      logger.warn('Transcribe found no speech; no captions added', context);
      await markFailed();
      await deleteScratch(logger, bucket, scratch);
      return;
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
      await writeCaptionTracks(entities, ref, {
        tracks: change.tracks,
        rev,
        nonce,
      });
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
