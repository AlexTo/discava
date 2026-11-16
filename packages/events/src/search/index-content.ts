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
import { createCoreTableService } from '@discava/core-table';
import {
  getOpenSearchClient,
  type IndexName,
  resolveIndexName,
} from '@discava/search';
import middy from '@middy/core';
import type { Client } from '@opensearch-project/opensearch';
import { z } from 'zod';
import { toCourseDocument } from './course-document.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'SearchIndexing';
process.env.POWERTOOLS_SERVICE_NAME = 'SearchIndexing';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

type StreamRecord = z.infer<typeof DynamoDBStreamSchema>['Records'][number];
type Image = Record<string, unknown> | undefined;

// Memoized across invocations on a warm Lambda, as in progress recalculation.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

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

const entityOf = (record: StreamRecord): string | undefined => {
  const image: Image = record.dynamodb.NewImage ?? record.dynamodb.OldImage;
  return image?.__edb_e__ as string | undefined;
};

// The distinct courses the batch's course records name. A record without a
// course id fails the batch: it can't be skipped without hiding a change.
const courseIdsOf = (records: StreamRecord[]) => {
  const courseIds = new Set<string>();
  for (const record of records) {
    if (entityOf(record) !== 'course') {
      continue;
    }
    const image: Image = record.dynamodb.NewImage ?? record.dynamodb.OldImage;
    if (typeof image?.courseId !== 'string' || image.courseId === '') {
      throw new Error('A course record names no course');
    }
    courseIds.add(image.courseId);
  }
  return courseIds;
};

// A course's doc exists only while it's published -- see
// SEARCH_STREAM_FILTERS and CourseDocumentSchema's `status: z.literal`.
// What's published is decided by the course as the table holds it now, not
// by the record that mentioned it.
const syncCourse = async (
  client: Client,
  coreTable: Awaited<ReturnType<typeof createCoreTableService>>,
  courseId: string,
) => {
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  if (course?.status !== 'published') {
    return deleteDoc(client, 'courses', courseId);
  }
  await client.index({
    index: resolveIndexName('courses'),
    id: courseId,
    body: toCourseDocument(course),
  });
};

// Keeps the courses index in step with the core table. The stream records
// only say which courses changed; each is read once by key and indexed or
// removed as it is now. Idempotent (every document id is the course's own
// key) and order-insensitive, so a late, duplicate or reordered delivery
// converges on the same document, the same philosophy as progress
// recalculation. A failure fails the batch, which the queue retries.
export const searchIndexing = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
): Promise<void> => {
  const courseIds = courseIdsOf(event.Records);
  if (courseIds.size === 0) {
    return;
  }
  const [client, coreTable] = await Promise.all([
    getOpenSearchClient(),
    getCoreTable(),
  ]);

  for (const courseId of courseIds) {
    await syncCourse(client, coreTable, courseId);
  }

  logger.info('Indexed search documents', {
    records: event.Records.length,
    courses: courseIds.size,
  });
  metrics.addMetric('RecordsIndexed', MetricUnit.Count, event.Records.length);
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(searchIndexing);
