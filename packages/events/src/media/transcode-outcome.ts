/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { scheduleTranscodeCleanupOrThrow } from '@discava/common-server-utils/cleanup-scheduler';
import { resolveLessonMediaUploadBucketName } from '@discava/common-server-utils/lesson-media-bucket';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import {
  manifestNonce,
  previewManifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';
import {
  type CaptionTargetKey,
  createCoreTableService,
  isConditionalCheckFailed,
  PREVIEW_MAX_SECONDS,
  TRANSCODE_PENDING_ATTRIBUTES,
  writeCaptionsFailed,
} from '@discava/core-table';
import { startCaptionJob } from './transcribe-client.js';

// S3Mock in local dev (#137).
const s3Client = new S3Client(s3ClientConfig());

// Memoized across invocations on a warm Lambda, same as the tRPC APIs'
// core-table plugin -- the DynamoDB client and resolved table name it
// depends on are already memoized in @discava/core-table.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;

export const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

interface OutcomeBase {
  jobId: string;
  // MediaConvert's job status: COMPLETE and ERROR are acted on, anything
  // else is ignored.
  status: string;
  rawObjectKey: string;
  submissionNonce: string;
  // The longest output's duration, from the job's output details; only a
  // preview's is checked (against PREVIEW_MAX_SECONDS).
  durationSeconds?: number;
}

/**
 * How a MediaConvert job ended, and the submission it was for: a lesson
 * video's (no `target` means `contentItem`) or a course preview's.
 */
export type TranscodeOutcome = OutcomeBase &
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

// The record's key, and the cleanup payload for one of its attempt folders.
const keyOf = (outcome: TranscodeOutcome): CaptionTargetKey =>
  outcome.target === 'coursePreview'
    ? { courseId: outcome.courseId }
    : {
        courseId: outcome.courseId,
        moduleId: outcome.moduleId,
        lessonId: outcome.lessonId,
        contentItemId: outcome.contentItemId,
      };

const cleanupParams = (
  outcome: TranscodeOutcome,
  submissionNonce: string,
): Parameters<typeof scheduleTranscodeCleanupOrThrow>[0] =>
  outcome.target === 'coursePreview'
    ? {
        target: 'coursePreview',
        courseId: outcome.courseId,
        submissionNonce,
      }
    : { ...(keyOf(outcome) as ItemKey), submissionNonce };

type ItemKey = Extract<CaptionTargetKey, { contentItemId: string }>;

// The record's patch builder, loosely typed: a content item and a preview
// take the same attributes and conditions here.
interface RecordPatch {
  set(values: Record<string, unknown>): RecordPatch;
  remove(attributes: string[]): RecordPatch;
  add(values: Record<string, unknown>): RecordPatch;
  where(condition: (attr: never, op: never) => string): RecordPatch;
  go(options?: { response: 'all_old' }): Promise<{
    data: { previousS3Key?: string } | null;
  }>;
}

const patchRecord = async (outcome: TranscodeOutcome): Promise<RecordPatch> => {
  const { entities } = await getCoreTable();
  return (outcome.target === 'coursePreview'
    ? entities.coursePreview.patch({ courseId: outcome.courseId })
    : entities.contentItem.patch(
        keyOf(outcome) as ItemKey,
      )) as unknown as RecordPatch;
};

// The submission is still the record's own: the condition of every write.
const ownsSubmission = (submissionNonce: string) =>
  ((
    attr: { submissionNonce: unknown },
    op: { eq(a: unknown, v: unknown): string },
  ) => op.eq(attr.submissionNonce, submissionNonce)) as unknown as (
    attr: never,
    op: never,
  ) => string;

// Deletes the version a completed replacement took over from, once nobody can
// still be streaming it: students may hold its signed cookies for up to their
// lifetime. The swap has already happened, so a failure here only leaves
// that output behind; it's logged for cleanup rather than retried, since a
// retry would find previousS3Key already gone.
const retirePreviousVersion = async (
  logger: Logger,
  outcome: TranscodeOutcome,
  previousS3Key: string | undefined,
): Promise<void> => {
  if (!previousS3Key) {
    return;
  }
  const { jobId } = outcome;
  const nonce =
    outcome.target === 'coursePreview'
      ? previewManifestNonce(previousS3Key)
      : manifestNonce(previousS3Key);
  if (!nonce) {
    // From before nonces: it shares the item's folder with the new version.
    logger.warn('Left a replaced video from before nonces in place', {
      jobId,
      previousS3Key,
    });
    return;
  }
  try {
    await scheduleTranscodeCleanupOrThrow(
      cleanupParams(outcome, nonce),
      RETIRED_VERSION_DELAY_MINUTES,
    );
  } catch (error) {
    logger.error('Failed to schedule a replaced video for deletion', {
      error,
      jobId,
      previousS3Key,
    });
  }
};

// Starts the version's automatic captions, best effort: a video is playable
// without them, so a failure here only marks the captioning failed (still
// conditioned on the version, so it can't touch a replacement) and is logged,
// never rethrown. A job that already exists for this version means the start
// already happened, so it is left alone.
const startCaptions = async (
  logger: Logger,
  target: Parameters<typeof startCaptionJob>[0],
): Promise<void> => {
  try {
    await startCaptionJob(target);
  } catch (error) {
    if ((error as Error | undefined)?.name === 'ConflictException') {
      logger.info('Caption job already started', { ...target });
      return;
    }
    logger.error('Failed to start the automatic captions', {
      error,
      ...target,
    });
    const { nonce, ...ref } = target;
    try {
      const { entities } = await getCoreTable();
      await writeCaptionsFailed(
        entities,
        'target' in ref ? { courseId: ref.courseId } : ref,
        nonce,
      );
    } catch (patchError) {
      // Left pending: the APIs report it as failed once it is old enough.
      logger.error('Failed to mark captions failed', {
        error: patchError,
        ...target,
      });
    }
  }
};

/**
 * Applies a finished transcode to its content item or course preview: on
 * COMPLETE the new version becomes ready (taking over from any previous one),
 * on ERROR it fails. Either way the record stops waiting (its
 * transcodePending pair is removed). A preview whose transcoded duration is
 * over PREVIEW_MAX_SECONDS fails as `too-long` instead, keeping any previous
 * version playable and scheduling the over-long output for cleanup. Every
 * write is conditioned on the submission still being the record's own, so
 * applying an outcome twice, or one a replacement has since superseded, is
 * safe: transcode-complete calls this for MediaConvert's event, and the
 * transcode reconciler for a job whose event never arrived or kept failing
 * (#125).
 */
export const applyTranscodeOutcome = async (
  logger: Logger,
  outcome: TranscodeOutcome,
): Promise<void> => {
  const { jobId, courseId, rawObjectKey, submissionNonce } = outcome;
  const isPreview = outcome.target === 'coursePreview';
  const ref = keyOf(outcome);
  const context = { jobId, submissionNonce, ...ref };

  // The record no longer owns this submission: it was deleted while
  // transcoding, or a replacement superseded it. Its own nonce-scoped output
  // is orphaned: a submission whose mediaConvertJobId never got stamped can't
  // be canceled/scheduled early by whatever retired it, so this event (AWS
  // guarantees every output is written before it's sent) is the only
  // remaining place that can clean it up.
  const scheduleOrphanCleanup = async () => {
    logger.info(
      'Record no longer owns this submission; scheduling its output for cleanup',
      context,
    );
    await scheduleTranscodeCleanupOrThrow(
      cleanupParams(outcome, submissionNonce),
    );
  };

  const deleteRawUpload = async () => {
    const uploadBucketName = await resolveLessonMediaUploadBucketName();
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: uploadBucketName,
          Key: rawObjectKey,
        }),
      );
    } catch (error) {
      logger.error('Failed to delete raw upload after transcode', {
        error,
        rawObjectKey,
      });
    }
  };

  // Marks the attempt failed, with a reason for a preview.
  const fail = async (failureReason: 'too-long' | 'transcode-error') => {
    try {
      await (await patchRecord(outcome))
        .set({
          status: 'failed',
          ...(isPreview && { failureReason }),
        })
        .remove([...TRANSCODE_PENDING_ATTRIBUTES])
        .where(ownsSubmission(submissionNonce))
        .go();
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        logger.error('Failed to mark the video failed after transcode', {
          error,
          ...context,
        });
        throw error;
      }
      await scheduleOrphanCleanup();
      return false;
    }
    return true;
  };

  if (outcome.status === 'COMPLETE') {
    if (
      isPreview &&
      outcome.durationSeconds !== undefined &&
      outcome.durationSeconds > PREVIEW_MAX_SECONDS
    ) {
      logger.warn('A preview is over the length limit', {
        ...context,
        durationSeconds: outcome.durationSeconds,
      });
      // The over-long output is never played, so it goes whether or not the
      // record still owned the attempt.
      if (await fail('too-long')) {
        await scheduleTranscodeCleanupOrThrow(
          cleanupParams(outcome, submissionNonce),
        );
      }
      await deleteRawUpload();
      return;
    }

    // Must match submitTranscodeJob's Destination exactly -- see its
    // docstring for why submissionNonce, not jobId, scopes this path.
    const manifestKey =
      outcome.target === 'coursePreview'
        ? `courses/${courseId}/preview/${submissionNonce}/master.m3u8`
        : `courses/${courseId}/modules/${outcome.moduleId}/lessons/${outcome.lessonId}/content-items/${outcome.contentItemId}/${submissionNonce}/master.m3u8`;
    let replaced: { previousS3Key?: string } | null = null;
    try {
      const { data } = await (await patchRecord(outcome))
        .set({
          status: 'ready',
          s3Key: manifestKey,
          // Captioning starts below; until it ends the version is waiting.
          captionsStatus: 'pending',
          captionsPendingSince: new Date().toISOString(),
          // A preview's duration becomes the transcoded one.
          ...(isPreview &&
            outcome.durationSeconds !== undefined && {
              durationSeconds: Math.min(
                PREVIEW_MAX_SECONDS,
                Math.max(1, Math.round(outcome.durationSeconds)),
              ),
            }),
        })
        // This version replaces the one students kept playing meanwhile
        // (#209); the old attributes, returned below, say which. Every
        // caption track belongs to an earlier version (dropOtherVersions of
        // a version that just became ready), so they all go, and the
        // revision moves on so a writer that read them can't land.
        .remove([
          'previousS3Key',
          'captionTracks',
          ...(isPreview ? ['failureReason'] : []),
          ...TRANSCODE_PENDING_ATTRIBUTES,
        ])
        .add({ captionTracksRev: 1 })
        // submissionNonce is persisted durably before submitTranscodeJob is
        // ever called, and gets overwritten as soon as a replacement
        // supersedes this job -- so a completion event only patches the
        // record while it's still genuinely this exact submission's own.
        .where(ownsSubmission(submissionNonce))
        .go({ response: 'all_old' });
      replaced = data;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        // Transient failure -- the record might still be this exact
        // submission's own. Rethrow so EventBridge retries the whole
        // invocation instead of silently dropping a real completion.
        logger.error('Failed to mark the video ready after transcode', {
          error,
          ...context,
        });
        throw error;
      }
      await scheduleOrphanCleanup();
      return;
    }

    await retirePreviousVersion(logger, outcome, replaced?.previousS3Key);

    await startCaptions(
      logger,
      outcome.target === 'coursePreview'
        ? { target: 'coursePreview', courseId, nonce: submissionNonce }
        : {
            courseId,
            moduleId: outcome.moduleId,
            lessonId: outcome.lessonId,
            contentItemId: outcome.contentItemId,
            nonce: submissionNonce,
          },
    );

    await deleteRawUpload();
  } else if (outcome.status === 'ERROR') {
    await fail('transcode-error');
  } else {
    logger.info('Ignoring MediaConvert job state change', {
      status: outcome.status,
    });
  }
};
