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
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { getCaptionJob } from './transcribe-client.js';
import { applyTranscribeOutcome } from './transcribe-outcome.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscribeComplete';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscribeComplete';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// Only the job's name and status: its tags and file locations come from
// GetTranscriptionJob.
const TranscribeJobStateChangeDetailSchema = z.object({
  TranscriptionJobName: z.string(),
  TranscriptionJobStatus: z.string(),
});

export const transcribeComplete = async (
  event: z.infer<typeof EventBridgeSchema>,
): Promise<void> => {
  logger.info('Received event', event);

  const detail = TranscribeJobStateChangeDetailSchema.parse(event.detail);
  const job = await getCaptionJob(detail.TranscriptionJobName);
  // The job's tags say which record it is for: a course's preview, or a
  // content item (no `target`, as before preview videos).
  const common = {
    jobName: detail.TranscriptionJobName,
    status: detail.TranscriptionJobStatus,
    nonce: job.nonce,
    vttKey: job.vttKey,
  };
  await applyTranscribeOutcome(
    logger,
    job.target === 'coursePreview'
      ? { ...common, target: 'coursePreview', courseId: job.courseId }
      : {
          ...common,
          courseId: job.courseId,
          moduleId: job.moduleId,
          lessonId: job.lessonId,
          contentItemId: job.contentItemId,
        },
  );
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: EventBridgeSchema }))
  .handler(transcribeComplete);
