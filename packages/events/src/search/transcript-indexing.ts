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
import { getOpenSearchClient } from '@discava/search';
import middy from '@middy/core';
import type { z } from 'zod';
import { sqsToStreamRecords } from '../router/sqs-stream-records.js';
import {
  type TranscriptAction,
  type TranscriptItemKey,
  transcriptActionOf,
} from './transcript-actions.js';
import {
  deleteTranscriptsBy,
  readCaptionFileFromS3,
  syncItemTranscripts,
} from './transcript-sync.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscriptIndexing';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscriptIndexing';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// Items synced at once: each reads three records, its caption files and the
// index, so a few in flight keep a full batch inside the Lambda's timeout
// without flooding the collection.
export const SYNC_CONCURRENCY = 5;

// Memoized across invocations on a warm Lambda, as in search indexing.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

// Runs `task` over `items`, at most `limit` at a time. The first failure stops
// the rest from starting and is thrown once the running ones finish.
const forEachLimited = async <T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < items.length) {
      const item = items[next++] as T;
      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (failure) {
    throw failure.error;
  }
};

// Keeps the transcripts index in step with the core table. The stream records
// only say which items changed; each is read from the table and its documents
// written or removed to match it. Idempotent and order-insensitive, the same
// philosophy as search indexing, so a late, duplicate or reordered delivery
// converges on the same documents. A failure fails the batch, which the
// queue retries.
export const transcriptIndexing = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
): Promise<void> => {
  const actions = event.Records.map((record) => transcriptActionOf(record));
  const wanted = actions.filter(
    (action): action is TranscriptAction => action !== undefined,
  );
  const skipped = actions.length - wanted.length;
  if (wanted.length === 0) {
    metrics.addMetric('RecordsSkipped', MetricUnit.Count, skipped);
    return;
  }

  const [client, coreTable] = await Promise.all([
    getOpenSearchClient(),
    getCoreTable(),
  ]);

  let removed = 0;
  const deletes = new Map<string, { field: string; value: string }>();
  const items = new Map<string, TranscriptItemKey>();
  for (const action of wanted) {
    if (action.type === 'delete-by') {
      deletes.set(`${action.field}:${action.value}`, action);
    } else {
      items.set(action.key.contentItemId, action.key);
    }
  }

  // Deletes first: an item removed in this batch has no table record left, so
  // its sync, if the batch also has one, would remove the same documents.
  for (const { field, value } of deletes.values()) {
    removed += await deleteTranscriptsBy(client, field, value);
  }

  let indexed = 0;
  await forEachLimited([...items.values()], SYNC_CONCURRENCY, async (key) => {
    const result = await syncItemTranscripts(
      { client, coreTable, readCaptionFile: readCaptionFileFromS3 },
      key,
    );
    indexed += result.indexed;
    removed += result.removed;
  });

  logger.info('Synced transcripts', {
    records: event.Records.length,
    items: items.size,
    indexed,
    removed,
  });
  metrics.addMetric('ItemsSynced', MetricUnit.Count, items.size);
  metrics.addMetric('PassagesIndexed', MetricUnit.Count, indexed);
  metrics.addMetric('PassagesRemoved', MetricUnit.Count, removed);
  metrics.addMetric('RecordsSkipped', MetricUnit.Count, skipped);
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(sqsToStreamRecords())
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(transcriptIndexing);
