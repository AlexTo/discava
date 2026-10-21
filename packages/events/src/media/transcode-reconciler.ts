/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { EventBridgeSchema } from '@aws-lambda-powertools/parser/schemas';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
  GetJobCommand,
  MediaConvertClient,
  NotFoundException,
} from '@aws-sdk/client-mediaconvert';
import {
  isConditionalCheckFailed,
  TRANSCODE_PENDING_ATTRIBUTES,
} from '@discava/core-table';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import type { z } from 'zod';
import { applyTranscodeOutcome, getCoreTable } from './transcode-outcome.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscodeReconciler';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscodeReconciler';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();
const mediaConvert = new MediaConvertClient({});

// A video waiting this long with no transcode job recorded never got one:
// submitting it failed, and so did marking it failed. Long enough for an
// upload's own retries to have settled.
export const NO_JOB_AFTER_MINUTES = 30;
// A video waiting this long with a job is worth asking MediaConvert about:
// well past a real transcode, so its completion event was most likely lost
// or kept failing (#185).
export const STUCK_AFTER_MINUTES = 120;

type PendingVideo = {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
  status: string;
  s3Key?: string;
  submissionNonce?: string;
  mediaConvertJobId?: string;
  transcodePendingSince?: string;
};

// What a stuck video came to.
type Resolution =
  | 'applied' // MediaConvert said it finished; applied as if its event came
  | 'failed' // nothing will ever finish it; marked failed
  | 'running' // its job is still going; left alone
  | 'waiting' // not stuck long enough yet
  | 'superseded'; // something else settled it first

const minutesAgo = (minutes: number, now: number) =>
  new Date(now - minutes * 60_000).toISOString();

// Marks a video that nothing will ever finish as failed, so the instructor
// sees it and can upload again. Conditioned on it still being this exact
// submission, still pending: a replacement or a late completion wins.
const markFailed = async (video: PendingVideo, reason: string) => {
  const coreTable = await getCoreTable();
  const { courseId, moduleId, lessonId, contentItemId, submissionNonce } =
    video;
  try {
    await coreTable.entities.contentItem
      .patch({ courseId, moduleId, lessonId, contentItemId })
      .set({ status: 'failed' })
      .remove([...TRANSCODE_PENDING_ATTRIBUTES])
      .where(
        (attr, op) =>
          `${op.eq(attr.status, 'pending')} AND ${
            submissionNonce
              ? op.eq(attr.submissionNonce, submissionNonce)
              : op.notExists(attr.submissionNonce)
          }`,
      )
      .go();
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return 'superseded' as const;
    }
    throw error;
  }
  logger.warn('Marked a stuck video failed', { reason, ...video });
  return 'failed' as const;
};

const reconcile = async (
  video: PendingVideo,
  now: number,
): Promise<Resolution> => {
  const { mediaConvertJobId: jobId } = video;
  if (!jobId) {
    return markFailed(video, 'no transcode job recorded');
  }
  if (
    (video.transcodePendingSince ?? '') > minutesAgo(STUCK_AFTER_MINUTES, now)
  ) {
    return 'waiting';
  }

  let job;
  try {
    ({ Job: job } = await mediaConvert.send(new GetJobCommand({ Id: jobId })));
  } catch (error) {
    if (error instanceof NotFoundException) {
      return markFailed(video, 'transcode job not found');
    }
    throw error;
  }

  switch (job?.Status) {
    case 'COMPLETE':
    case 'ERROR': {
      const { courseId, moduleId, lessonId, contentItemId } = video;
      await applyTranscodeOutcome(logger, {
        jobId,
        status: job.Status,
        courseId,
        moduleId,
        lessonId,
        contentItemId,
        rawObjectKey: job.UserMetadata?.rawObjectKey ?? video.s3Key ?? '',
        // The submission the job was for: if the item has moved on to a
        // replacement since, the outcome's own conditions leave it alone.
        submissionNonce:
          job.UserMetadata?.submissionNonce ?? video.submissionNonce ?? '',
      });
      logger.warn('Applied a transcode whose outcome never arrived', {
        jobId,
        jobStatus: job.Status,
        ...video,
      });
      return 'applied';
    }
    case 'CANCELED':
      return markFailed(video, 'transcode job was canceled');
    default:
      // SUBMITTED or PROGRESSING: still going, however long it's taking.
      return 'running';
  }
};

/**
 * Finds lesson videos stuck waiting for a transcode and settles them (#125),
 * on a schedule. A video is stuck when its transcode finished but the
 * completion event never arrived or kept failing (#185), or when it never got
 * a job at all. Each is checked with MediaConvert and settled through the same
 * applyTranscodeOutcome as transcode-complete, or marked failed if nothing
 * will ever finish it. Only videos in the sparse byTranscodePending index are
 * read, so a run with nothing stuck is one empty query.
 */
export const transcodeReconciler = async (
  event: z.infer<typeof EventBridgeSchema>,
): Promise<void> => {
  logger.info('Received event', event);
  const now = Date.now();
  const coreTable = await getCoreTable();

  const { data } = await coreTable.entities.contentItem.query
    .byTranscodePending({ transcodePending: 'pending' })
    .lt({ transcodePendingSince: minutesAgo(NO_JOB_AFTER_MINUTES, now) })
    .go({ pages: 'all' });

  const counts: Record<Resolution | 'errors', number> = {
    applied: 0,
    failed: 0,
    running: 0,
    waiting: 0,
    superseded: 0,
    errors: 0,
  };
  // One at a time: there are rarely any, and each is a few small calls.
  for (const video of data as PendingVideo[]) {
    try {
      counts[await reconcile(video, now)]++;
    } catch (error) {
      // One video failing doesn't stop the rest; the next run tries again.
      counts.errors++;
      logger.error('Failed to reconcile a pending video', { error, ...video });
    }
  }

  logger.info('Reconciled pending videos', { checked: data.length, ...counts });
  metrics.addMetric('StuckVideosApplied', MetricUnit.Count, counts.applied);
  metrics.addMetric('StuckVideosFailed', MetricUnit.Count, counts.failed);
  metrics.addMetric('ReconcileErrors', MetricUnit.Count, counts.errors);
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: EventBridgeSchema }))
  .handler(transcodeReconciler);
