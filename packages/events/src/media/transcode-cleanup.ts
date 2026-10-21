/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { s3ClientConfig } from '@discava/common-server-utils/local-dev';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { resolveLessonMediaBucketName } from '../lib/runtime-config.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscodeCleanup';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscodeCleanup';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();
// S3Mock in local dev (#137).
const s3Client = new S3Client(s3ClientConfig());

// Same page size DeleteObjects itself caps out at.
const S3_PAGE_SIZE = 1000;

const CleanupEventSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
  submissionNonce: z.string(),
});

// Invoked directly by an EventBridge Scheduler one-time schedule that
// bestEffortCancelTranscodeJob creates alongside canceling a job -- not
// wrapped in an EventBridge event envelope, just this plain payload.
//
// Deletes everything under one specific job's own nonce-scoped
// subdirectory -- see submitTranscodeJob's docstring for why that
// subdirectory is guaranteed disjoint from whatever job superseded this
// one, which is what makes an unconditional delete here safe: nothing
// else will ever write to or reference this exact prefix again,
// regardless of what's happened to the content item since the job was
// canceled. Errors are allowed to propagate (not swallowed) so
// EventBridge Scheduler's own retry policy can retry a transient failure
// -- unlike transcode-complete.ts, every invocation of this handler is
// safe to retry: deleting an already-deleted prefix is a no-op.
export const transcodeCleanup = async (event: unknown): Promise<void> => {
  logger.info('Received event', event as Record<string, unknown>);

  const { courseId, moduleId, lessonId, contentItemId, submissionNonce } =
    CleanupEventSchema.parse(event);

  const bucket = await resolveLessonMediaBucketName();
  const prefix = `courses/${courseId}/modules/${moduleId}/lessons/${lessonId}/content-items/${contentItemId}/${submissionNonce}/`;

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
    for (const object of Contents ?? []) {
      if (object.Key !== undefined) {
        keys.push(object.Key);
      }
    }
    continuationToken = IsTruncated ? NextContinuationToken : undefined;
  } while (continuationToken !== undefined);

  if (keys.length === 0) {
    logger.info('Nothing to clean up under this job prefix', {
      bucket,
      prefix,
    });
    return;
  }

  for (let i = 0; i < keys.length; i += S3_PAGE_SIZE) {
    const batch = keys.slice(i, i + S3_PAGE_SIZE);
    const { Errors } = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })) },
      }),
    );
    // DeleteObjects can resolve with a 200 and still fail individual keys
    // -- a per-key error here doesn't raise as a rejected promise, so it
    // has to be checked explicitly. Throwing (rather than logging and
    // continuing) is what makes EventBridge Scheduler retry the whole
    // invocation, same as any other failure this handler doesn't swallow.
    if (Errors && Errors.length > 0) {
      throw new Error(
        `DeleteObjects failed for ${Errors.length} of ${batch.length} keys: ${Errors.map((error) => `${error.Key} (${error.Code})`).join(', ')}`,
      );
    }
  }

  logger.info('Deleted orphaned transcode output', {
    bucket,
    prefix,
    count: keys.length,
  });
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(transcodeCleanup);
