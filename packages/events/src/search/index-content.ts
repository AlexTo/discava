/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { parser } from '@aws-lambda-powertools/parser/middleware';
import { DynamoDBStreamSchema } from '@aws-lambda-powertools/parser/schemas';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import {
  CourseDocumentSchema,
  getOpenSearchClient,
  type IndexName,
  resolveIndexName,
} from '@discava/search';
import middy from '@middy/core';
import type { Client } from '@opensearch-project/opensearch';
import { z } from 'zod';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'SearchIndexing';
process.env.POWERTOOLS_SERVICE_NAME = 'SearchIndexing';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

type StreamRecord = z.infer<typeof DynamoDBStreamSchema>['Records'][number];
type Image = Record<string, unknown> | undefined;

// Deletes are idempotent: a document that was never indexed, or was already
// removed by a previous (retried) run, isn't a failure.
const deleteDoc = async (client: Client, index: IndexName, id: string) => {
  try {
    await client.delete({ index: resolveIndexName(index), id });
  } catch (error) {
    if (
      (error as { meta?: { statusCode?: number } })?.meta?.statusCode !== 404
    ) {
      throw error;
    }
  }
};

// A course's doc exists only while it's published -- see
// SEARCH_STREAM_FILTERS and CourseDocumentSchema's `status: z.literal`.
const indexOrDeleteCourse = async (client: Client, record: StreamRecord) => {
  if (record.eventName === 'REMOVE') {
    const old: Image = record.dynamodb.OldImage;
    return deleteDoc(client, 'courses', String(old?.courseId));
  }
  const image: Image = record.dynamodb.NewImage;
  const courseId = String(image?.courseId);
  if (image?.status !== 'published') {
    return deleteDoc(client, 'courses', courseId);
  }
  const doc = CourseDocumentSchema.parse({
    courseId,
    title: image.title,
    description: image.description,
    status: 'published',
    publishedAt: image.publishedAt ?? image.updatedAt,
    updatedAt: image.updatedAt,
  });
  await client.index({
    index: resolveIndexName('courses'),
    id: courseId,
    body: doc,
  });
};

const entityOf = (record: StreamRecord): string | undefined => {
  const image: Image = record.dynamodb.NewImage ?? record.dynamodb.OldImage;
  return image?.__edb_e__ as string | undefined;
};

// Keeps the courses index in step with the core table. Idempotent (every
// document id is the course's own key) and safe to retry or replay: each
// record's document is re-derived from its full image rather than applied
// as a diff, the same philosophy as progress recalculation.
export const searchIndexing = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
): Promise<void> => {
  const client = await getOpenSearchClient();

  for (const record of event.Records) {
    if (entityOf(record) === 'course') {
      await indexOrDeleteCourse(client, record);
    }
  }

  logger.info('Indexed search documents', { records: event.Records.length });
  metrics.addMetric('RecordsIndexed', MetricUnit.Count, event.Records.length);
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(searchIndexing);
