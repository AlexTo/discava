/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { isLocalDev } from '@discava/common-server-utils/local-dev';
import {
  type CaptionTargetKey,
  requestCaptionTranslation,
} from '@discava/core-table';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import type { z } from 'zod';
import { sqsToStreamRecords } from '../router/sqs-stream-records.js';
import { translateVideoCaptions } from './caption-translation-outcome.js';
import { getCoreTable } from './transcode-outcome.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'CaptionTranslation';
process.env.POWERTOOLS_SERVICE_NAME = 'CaptionTranslation';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();
// The stack sets STAGE_NAME; local dev has no stage.
metrics.setDefaultDimensions({
  Stage: isLocalDev() ? 'local' : (process.env.STAGE_NAME ?? 'unknown'),
});

type StreamRecord = z.infer<typeof DynamoDBStreamSchema>['Records'][number];
type Image = Record<string, unknown> | undefined;

type Target =
  | { kind: 'course'; courseId: string }
  | { kind: 'video'; key: CaptionTargetKey };

const text = (image: Image, name: string, entity: string): string => {
  const value = image?.[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`A ${entity} record names no ${name}`);
  }
  return value;
};

// What a record is about, from its key attributes only. One that can't be
// identified fails the batch: skipping it would hide a change.
const targetOf = (record: StreamRecord): Target => {
  const image: Image = record.dynamodb.NewImage ?? record.dynamodb.OldImage;
  const entity = image?.__edb_e__;
  switch (entity) {
    case 'course':
      return { kind: 'course', courseId: text(image, 'courseId', entity) };
    case 'coursePreview':
      return {
        kind: 'video',
        key: { courseId: text(image, 'courseId', entity) },
      };
    case 'contentItem':
      return {
        kind: 'video',
        key: {
          courseId: text(image, 'courseId', entity),
          moduleId: text(image, 'moduleId', entity),
          lessonId: text(image, 'lessonId', entity),
          contentItemId: text(image, 'contentItemId', entity),
        },
      };
    default:
      throw new Error(`Can't tell what a ${String(entity)} record is for`);
  }
};

// A course changed: ask each of its videos that has caption tracks to work
// out its translations again. Nothing is translated here.
const requestCourseVideos = async (courseId: string): Promise<number> => {
  const { entities, collections } = await getCoreTable();
  const course = (await entities.course.get({ courseId }).go()).data;
  if (!course) {
    return 0;
  }
  const { data } = await collections
    .curriculum({ courseId })
    .go({ pages: 'all' });
  const keys: CaptionTargetKey[] = data.contentItem
    .filter((item) => item.type === 'video' && item.captionTracks?.length)
    .map(({ moduleId, lessonId, contentItemId }) => ({
      courseId,
      moduleId,
      lessonId,
      contentItemId,
    }));
  const preview = (await entities.coursePreview.get({ courseId }).go()).data;
  if (preview?.captionTracks?.length) {
    keys.push({ courseId });
  }
  for (const key of keys) {
    await requestCaptionTranslation(entities, key);
  }
  return keys.length;
};

// Translates the captions of the videos the batch names. The records only say
// which course or video changed; each is handled once, from the record as it
// is now, so a duplicate or reordered delivery converges on the same tracks
// (see caption-translation-outcome.ts). A failure fails the batch, which the
// queue retries.
export const captionTranslation = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
  context: Pick<Context, 'getRemainingTimeInMillis'>,
): Promise<void> => {
  const targets = new Map<string, Target>();
  for (const record of event.Records) {
    const target = targetOf(record);
    targets.set(JSON.stringify(target), target);
  }
  for (const target of targets.values()) {
    if (target.kind === 'course') {
      const videos = await requestCourseVideos(target.courseId);
      logger.info("Asked a course's videos to translate again", {
        courseId: target.courseId,
        videos,
      });
    } else {
      await translateVideoCaptions(logger, metrics, target.key, {
        remainingMs: context.getRemainingTimeInMillis(),
      });
    }
  }
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(sqsToStreamRecords())
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(captionTranslation);
