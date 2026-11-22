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
import { getOpenSearchClient } from '@discava/search';
import middy from '@middy/core';
import type { Context } from 'aws-lambda';
import {
  deleteTranscriptIds,
  indexedTranscriptIds,
  readCaptionFileFromS3,
  syncItemTranscripts,
} from './transcript-sync.js';

export type { Context };

process.env.POWERTOOLS_METRICS_NAMESPACE = 'TranscriptReindex';
process.env.POWERTOOLS_SERVICE_NAME = 'TranscriptReindex';

const tracer = new Tracer();
const logger = new Logger();
const metrics = new Metrics();

// The Lambda hands back a cursor when less than this remains, so a course in
// flight can still finish.
export const LOW_TIME_MILLISECONDS = 60_000;

// Every status a course can have, in the order the rebuild visits them.
const STATUSES = ['draft', 'published', 'archived'] as const;

export interface TranscriptReindexEvent {
  /** Rebuild this course only. @default every course */
  courseId?: string;
  /** Where a previous call stopped. */
  cursor?: string;
}

export interface TranscriptReindexResult {
  courses: number;
  items: number;
  indexed: number;
  removed: number;
  /** Present when time ran out: call again with it. */
  cursor?: string;
}

interface Deps {
  client: Awaited<ReturnType<typeof getOpenSearchClient>>;
  coreTable: Awaited<ReturnType<typeof createCoreTableService>>;
}

// A cursor names the last course finished: its status's position in STATUSES
// and its id. Course ids are sortable and each status lists them in order, so
// the next call starts at the first course after it.
const encodeCursor = (statusIndex: number, courseId: string) =>
  `${statusIndex}:${courseId}`;

const decodeCursor = (cursor: string) => {
  const at = cursor.indexOf(':');
  const statusIndex = Number(cursor.slice(0, at));
  if (
    at < 1 ||
    !Number.isInteger(statusIndex) ||
    statusIndex >= STATUSES.length
  ) {
    throw new Error(`Not a transcript rebuild cursor: ${cursor}`);
  }
  return { statusIndex, courseId: cursor.slice(at + 1) };
};

// Syncs each of the course's video items, then removes the documents of items
// that are not among them. `syncItemTranscripts` decides, from the table, what
// each video wants, including nothing when it is hidden.
const rebuildCourse = async ({ client, coreTable }: Deps, courseId: string) => {
  const { data } = await coreTable.collections
    .curriculum({ courseId })
    .go({ pages: 'all' });
  const videos = data.contentItem.filter((item) => item.type === 'video');

  let indexed = 0;
  let removed = 0;
  for (const { moduleId, lessonId, contentItemId } of videos) {
    const result = await syncItemTranscripts(
      { client, coreTable, readCaptionFile: readCaptionFileFromS3 },
      { courseId, moduleId, lessonId, contentItemId },
    );
    indexed += result.indexed;
    removed += result.removed;
  }

  // A document id starts with its item's id (`<contentItemId>.<trackId>.<seq>`).
  const videoIds = new Set(videos.map(({ contentItemId }) => contentItemId));
  const orphans = (
    await indexedTranscriptIds(client, 'courseId', courseId)
  ).filter((id) => !videoIds.has(id.slice(0, id.indexOf('.'))));
  await deleteTranscriptIds(client, orphans);
  return { items: videos.length, indexed, removed: removed + orphans.length };
};

/**
 * Rebuilds the transcripts index from the core table and the caption files:
 * one course, or every course by status, resuming from a cursor. Idempotent:
 * every document id is its item's, track's and passage's own. Invoked by hand
 * (`nx run @discava/tooling-deploy:reindex-transcripts`) after the index is
 * recreated or an indexing bug; nothing triggers it.
 */
export const transcriptReindex = async (
  event: TranscriptReindexEvent,
  context: Pick<Context, 'getRemainingTimeInMillis'>,
): Promise<TranscriptReindexResult> => {
  const [coreTable, client] = await Promise.all([
    createCoreTableService(),
    getOpenSearchClient(),
  ]);
  const deps = { client, coreTable };
  const total: TranscriptReindexResult = {
    courses: 0,
    items: 0,
    indexed: 0,
    removed: 0,
  };
  const add = (part: Omit<TranscriptReindexResult, 'courses' | 'cursor'>) => {
    total.courses++;
    total.items += part.items;
    total.indexed += part.indexed;
    total.removed += part.removed;
  };

  if (event.courseId) {
    add(await rebuildCourse(deps, event.courseId));
  } else {
    const resume = event.cursor ? decodeCursor(event.cursor) : undefined;
    let cursor: string | undefined;
    let stopped = false;
    scan: for (
      let statusIndex = resume?.statusIndex ?? 0;
      statusIndex < STATUSES.length;
      statusIndex++
    ) {
      const { data } = await coreTable.entities.course.query
        .byStatus({
          status: STATUSES[statusIndex] as (typeof STATUSES)[number],
        })
        .go({ pages: 'all' });
      for (const { courseId } of data) {
        if (
          resume &&
          statusIndex === resume.statusIndex &&
          courseId <= resume.courseId
        ) {
          continue;
        }
        // At least one course a call, so a call always makes progress.
        if (
          total.courses > 0 &&
          context.getRemainingTimeInMillis() < LOW_TIME_MILLISECONDS
        ) {
          stopped = true;
          break scan;
        }
        add(await rebuildCourse(deps, courseId));
        cursor = encodeCursor(statusIndex, courseId);
      }
    }
    if (stopped && cursor) {
      total.cursor = cursor;
    }
  }

  const { cursor: _cursor, ...counts } = total;
  logger.info('Rebuilt transcripts', counts);
  metrics.addMetric('CoursesRebuilt', MetricUnit.Count, total.courses);
  metrics.addMetric('PassagesIndexed', MetricUnit.Count, total.indexed);
  metrics.addMetric('PassagesRemoved', MetricUnit.Count, total.removed);
  return total;
};

export const handler = middy<TranscriptReindexEvent, TranscriptReindexResult>()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .handler(transcriptReindex);
