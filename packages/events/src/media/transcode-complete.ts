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
import { durationSecondsOf } from './job-duration.js';
import { applyTranscodeOutcome } from './transcode-outcome.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscodeComplete';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscodeComplete';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// A job's metadata is a lesson video's (no `target`) or a course preview's.
const UserMetadataSchema = z.union([
  z.object({
    target: z.literal('contentItem').optional(),
    courseId: z.string(),
    moduleId: z.string(),
    lessonId: z.string(),
    contentItemId: z.string(),
    rawObjectKey: z.string(),
    submissionNonce: z.string(),
  }),
  z.object({
    target: z.literal('coursePreview'),
    courseId: z.string(),
    rawObjectKey: z.string(),
    submissionNonce: z.string(),
  }),
]);

const MediaConvertJobStateChangeDetailSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  userMetadata: UserMetadataSchema,
  // What a finished job reports for each output, as the preview length check
  // reads it.
  outputGroupDetails: z
    .array(
      z.object({
        outputDetails: z
          .array(z.object({ durationInMs: z.number().optional() }))
          .optional(),
      }),
    )
    .optional(),
});

export const transcodeComplete = async (
  event: z.infer<typeof EventBridgeSchema>,
): Promise<void> => {
  logger.info('Received event', event);

  const detail = MediaConvertJobStateChangeDetailSchema.parse(event.detail);
  await applyTranscodeOutcome(logger, {
    jobId: detail.jobId,
    status: detail.status,
    durationSeconds: durationSecondsOf(
      detail.outputGroupDetails?.map((group) => ({
        durationsInMs: (group.outputDetails ?? []).map((o) => o.durationInMs),
      })),
    ),
    ...detail.userMetadata,
  });
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: EventBridgeSchema }))
  .handler(transcodeComplete);
