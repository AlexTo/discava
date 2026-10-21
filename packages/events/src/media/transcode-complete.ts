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
import { applyTranscodeOutcome } from './transcode-outcome.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscodeComplete';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscodeComplete';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

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

export const transcodeComplete = async (
  event: z.infer<typeof EventBridgeSchema>,
): Promise<void> => {
  logger.info('Received event', event);

  const detail = MediaConvertJobStateChangeDetailSchema.parse(event.detail);
  await applyTranscodeOutcome(logger, {
    jobId: detail.jobId,
    status: detail.status,
    ...detail.userMetadata,
  });
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: EventBridgeSchema }))
  .handler(transcodeComplete);
