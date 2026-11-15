/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { createCoreTableService } from '@discava/core-table';
import { getOpenSearchClient, resolveIndexName } from '@discava/search';
import middy from '@middy/core';
import type { Client } from '@opensearch-project/opensearch';
import type { Context } from 'aws-lambda';
import { toCourseDocument } from './course-document.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'SearchReindex';
process.env.POWERTOOLS_SERVICE_NAME = 'SearchReindex';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// Documents per _bulk call, and per page of the stale-id scan.
export const BATCH_SIZE = 500;

export interface ReindexResult {
  indexed: number;
  removed: number;
}

const assertNoBulkErrors = (response: {
  errors: boolean;
  items: unknown[];
}) => {
  if (response.errors) {
    throw new Error(
      `_bulk reported failures: ${JSON.stringify(response.items)}`,
    );
  }
};

// Every id currently in the index, read with `search_after`: OpenSearch
// Serverless has no scroll API. Sorting by `_id` needs no mapping of its own.
const indexedCourseIds = async (
  client: Client,
  index: string,
): Promise<string[]> => {
  const ids: string[] = [];
  let searchAfter: (string | number)[] | undefined;
  for (;;) {
    const { body } = await client.search({
      index,
      body: {
        size: BATCH_SIZE,
        _source: false,
        sort: [{ _id: 'asc' }],
        ...(searchAfter && { search_after: searchAfter }),
      },
    });
    const hits = body.hits.hits as { _id: string; sort: (string | number)[] }[];
    ids.push(...hits.map((hit) => hit._id));
    if (hits.length < BATCH_SIZE) {
      return ids;
    }
    searchAfter = hits[hits.length - 1]!.sort;
  }
};

/**
 * Re-indexes every published course from the core table, then removes the
 * documents of courses that aren't published any more (one unpublished while
 * the indexer was down would otherwise stay searchable). Idempotent: every
 * document id is the course's own id, so a second run rewrites the same
 * documents. Invoked by hand (`nx run @discava/common-scripts:reindex-search`)
 * after the index is recreated or an indexing bug; nothing triggers it.
 */
export const searchReindex = async (): Promise<ReindexResult> => {
  const [coreTable, client] = await Promise.all([
    createCoreTableService(),
    getOpenSearchClient(),
  ]);
  const index = resolveIndexName('courses');

  let indexed = 0;
  const publishedIds = new Set<string>();
  let cursor: string | null | undefined;
  do {
    const { data: page, cursor: next } = await coreTable.entities.course.query
      .byStatus({ status: 'published' })
      .go({ cursor, limit: BATCH_SIZE });

    if (page.length > 0) {
      const body = page.flatMap((course) => {
        const doc = toCourseDocument(course);
        publishedIds.add(doc.courseId);
        return [{ index: { _index: index, _id: doc.courseId } }, doc];
      });
      assertNoBulkErrors((await client.bulk({ body })).body);
      indexed += page.length;
    }
    cursor = next;
  } while (cursor);

  const staleIds = (await indexedCourseIds(client, index)).filter(
    (id) => !publishedIds.has(id),
  );
  for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
    assertNoBulkErrors(
      (
        await client.bulk({
          body: staleIds
            .slice(i, i + BATCH_SIZE)
            .map((id) => ({ delete: { _index: index, _id: id } })),
        })
      ).body,
    );
  }

  const result = { indexed, removed: staleIds.length };
  logger.info('Re-indexed courses', result);
  metrics.addMetric('CoursesIndexed', MetricUnit.Count, indexed);
  metrics.addMetric('StaleDocumentsRemoved', MetricUnit.Count, staleIds.length);
  return result;
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(searchReindex);
