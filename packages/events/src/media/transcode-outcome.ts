/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Logger } from '@aws-lambda-powertools/logger';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import {
  manifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';
import {
  createCoreTableService,
  isConditionalCheckFailed,
  TRANSCODE_PENDING_ATTRIBUTES,
} from '@discava/core-table';
import { resolveLessonMediaUploadBucketName } from '../lib/runtime-config.js';
import { scheduleTranscodeCleanupOrThrow } from '../lib/transcode-cleanup-scheduler.js';

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

/** How a MediaConvert job ended, and the submission it was for. */
export interface TranscodeOutcome {
  jobId: string;
  // MediaConvert's job status: COMPLETE and ERROR are acted on, anything
  // else is ignored.
  status: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  rawObjectKey: string;
  submissionNonce: string;
}

// Deletes the version a completed replacement took over from, once nobody can
// still be streaming it: students may hold its signed cookies for up to their
// lifetime. The swap has already happened, so a failure here only leaves
// that output behind; it's logged for cleanup rather than retried, since a
// retry would find previousS3Key already gone.
const retirePreviousVersion = async (
  logger: Logger,
  previousS3Key: string | undefined,
  item: {
    jobId: string;
    courseId: string;
    moduleId: string;
    lessonId: string;
    contentItemId: string;
  },
): Promise<void> => {
  if (!previousS3Key) {
    return;
  }
  const { jobId, ...ref } = item;
  const nonce = manifestNonce(previousS3Key);
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
      { ...ref, submissionNonce: nonce },
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

/**
 * Applies a finished transcode to its content item: on COMPLETE the new
 * version becomes ready (taking over from any previous one), on ERROR it
 * fails. Either way the item stops waiting (its transcodePending pair is
 * removed). Every write is conditioned on the submission still being the
 * item's own, so applying an outcome twice, or one a replacement has since
 * superseded, is safe: transcode-complete calls this for MediaConvert's
 * event, and the transcode reconciler for a job whose event never arrived or
 * kept failing (#125).
 */
export const applyTranscodeOutcome = async (
  logger: Logger,
  outcome: TranscodeOutcome,
): Promise<void> => {
  const {
    jobId,
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    rawObjectKey,
    submissionNonce,
  } = outcome;
  const coreTable = await getCoreTable();

  if (outcome.status === 'COMPLETE') {
    // Must match submitTranscodeJob's Destination exactly -- see its
    // docstring for why submissionNonce, not jobId, scopes this path.
    const manifestKey = `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/${contentItemId}/${submissionNonce}/master.m3u8`;
    let replaced: { previousS3Key?: string } | null = null;
    try {
      const { data } = await coreTable.entities.contentItem
        .patch({ courseId, moduleId, lessonId, contentItemId })
        .set({ status: 'ready', s3Key: manifestKey })
        // This version replaces the one students kept playing meanwhile
        // (#209); the old attributes, returned below, say which.
        .remove(['previousS3Key', ...TRANSCODE_PENDING_ATTRIBUTES])
        // submissionNonce is persisted durably before submitTranscodeJob is
        // ever called, and gets overwritten as soon as a replacement
        // supersedes this job -- so a completion event only patches the
        // record while it's still genuinely this exact submission's own.
        .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce))
        .go({ response: 'all_old' });
      replaced = data;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        // Transient failure -- the record might still be this exact
        // submission's own. Rethrow so EventBridge retries the whole
        // invocation instead of silently dropping a real completion.
        logger.error('Failed to mark content item ready after transcode', {
          error,
          jobId,
          submissionNonce,
          courseId,
          moduleId,
          lessonId,
          contentItemId,
        });
        throw error;
      }
      // Either the instructor deleted the content item while transcoding
      // was in flight, or a later replacement upload has already
      // superseded this job -- in both cases the DynamoDB record stays
      // the source of truth and this event must not overwrite it. This
      // job's own nonce-scoped output is now orphaned, though: a
      // submission whose mediaConvertJobId never got stamped (see item 20
      // in the PR) can't be canceled/scheduled early by whatever
      // delete/replace call retired it, since that needs a job ID it
      // never has. This event -- AWS guarantees every output is written
      // before it's sent -- is the only remaining place that can clean it
      // up.
      logger.info(
        'Content item no longer owns this submission; scheduling its output for cleanup',
        { jobId, submissionNonce, courseId, moduleId, lessonId, contentItemId },
      );
      await scheduleTranscodeCleanupOrThrow({
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        submissionNonce,
      });
      return;
    }

    await retirePreviousVersion(logger, replaced?.previousS3Key, {
      jobId,
      courseId,
      moduleId,
      lessonId,
      contentItemId,
    });

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
  } else if (outcome.status === 'ERROR') {
    try {
      await coreTable.entities.contentItem
        .patch({ courseId, moduleId, lessonId, contentItemId })
        .set({ status: 'failed' })
        .remove([...TRANSCODE_PENDING_ATTRIBUTES])
        .where((attr, op) => op.eq(attr.submissionNonce, submissionNonce))
        .go();
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        logger.error('Failed to mark content item failed after transcode', {
          error,
          jobId,
          submissionNonce,
          courseId,
          moduleId,
          lessonId,
          contentItemId,
        });
        throw error;
      }
      // Same two possible causes as the COMPLETE branch above -- clean up
      // whatever this job wrote before erroring out, if anything.
      logger.info(
        'Content item no longer owns this submission; scheduling its output for cleanup',
        { jobId, submissionNonce, courseId, moduleId, lessonId, contentItemId },
      );
      await scheduleTranscodeCleanupOrThrow({
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        submissionNonce,
      });
    }
  } else {
    logger.info('Ignoring MediaConvert job state change', {
      status: outcome.status,
    });
  }
};
