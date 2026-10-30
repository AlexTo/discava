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
import middy from '@middy/core';
import { z } from 'zod';
import { indexRecords } from './index-records.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'SearchIndexer';
process.env.POWERTOOLS_SERVICE_NAME = 'SearchIndexer';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// Memoized across invocations on a warm Lambda, as in the other handlers.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

type StreamEvent = z.infer<typeof DynamoDBStreamSchema>;

// Keeps the search indices in step with the core table: each batch is the
// records that SEARCH_STREAM_FILTERS let through (the indexed content types
// and users), and the indexer reindexes each affected course and user from
// the table's current state, so a duplicate record or a burst of edits only
// produces the same result again. A failure fails the batch, which the event
// source mapping retries.
export const searchIndexer = async (event: StreamEvent): Promise<void> => {
  const coreTable = await getCoreTable();
  const { courses, users } = await indexRecords({
    coreTable,
    records: event.Records,
  });
  logger.info('Reindexed search documents', {
    records: event.Records.length,
    courses,
    users,
  });
  metrics.addMetric('CoursesIndexed', MetricUnit.Count, courses);
  metrics.addMetric('UsersIndexed', MetricUnit.Count, users);
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(searchIndexer);
