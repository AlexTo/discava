/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { EventBridgeSchema } from '@aws-lambda-powertools/parser/schemas';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  manifestNonce,
  RETIRED_VERSION_DELAY_MINUTES,
} from '@discava/common-server-utils/media-keys';
import {
  createCoreTableService,
  isConditionalCheckFailed,
} from '@discava/core-table';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { resolveLessonMediaUploadBucketName } from '../lib/runtime-config.js';
import { scheduleTranscodeCleanupOrThrow } from '../lib/transcode-cleanup-scheduler.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscodeComplete';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscodeComplete';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();
const s3Client = new S3Client({});

// Memoized across invocations on a warm Lambda, same as the tRPC APIs'
// core-table plugin -- the DynamoDB client and resolved table name it
// depends on are already memoized in @discava/core-table.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;

const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

const MediaConvertJobStateChangeDetailSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  userMetadata: z.object({
    courseId: z.string(),
    moduleId: z.string(),
    lessonId: z.string(),
    contentItemId: z.string(),
    rawObjectKey: z.string(),
    submissionNonce: z.string(),
  }),
});

// Deletes the version a completed replacement took over from, once nobody can
// still be streaming it: students may hold its signed cookies for up to their
// lifetime. The swap has already happened, so a failure here only leaves
// that output behind; it's logged for cleanup rather than retried, since a
// retry would find previousS3Key already gone.
const retirePreviousVersion = async (
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

export const transcodeComplete = async (
  event: z.infer<typeof EventBridgeSchema>,
): Promise<void> => {
  logger.info('Received event', event);

  const detail = MediaConvertJobStateChangeDetailSchema.parse(event.detail);
  const { jobId } = detail;
  const {
    courseId,
    moduleId,
    lessonId,
    contentItemId,
    rawObjectKey,
    submissionNonce,
  } = detail.userMetadata;

  const coreTable = await getCoreTable();

  if (detail.status === 'COMPLETE') {
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
        .remove(['previousS3Key'])
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

    await retirePreviousVersion(replaced?.previousS3Key, {
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
  } else if (detail.status === 'ERROR') {
    try {
      await coreTable.entities.contentItem
        .patch({ courseId, moduleId, lessonId, contentItemId })
        .set({ status: 'failed' })
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
      status: detail.status,
    });
  }
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: EventBridgeSchema }))
  .handler(transcodeComplete);
