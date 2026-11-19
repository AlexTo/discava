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
  type AnalyticsChange,
  type AnalyticsChangeResult,
  applyAnalyticsChange,
  contributionsOfChange,
  createCoreTableService,
  type FunnelTask,
  funnelTasksOfChange,
  moveLessonFunnel,
  moveStudentFunnels,
} from '@discava/core-table';
import middy from '@middy/core';
import { z } from 'zod';
import { sqsToStreamRecords } from '../router/sqs-stream-records.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'AnalyticsUpdate';
process.env.POWERTOOLS_SERVICE_NAME = 'AnalyticsUpdate';

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

// How many courses are applied at once.
const CONCURRENCY = 10;

type Image = Record<string, unknown> | undefined;

// The single writer of the instructor dashboard's aggregates: each record's
// change is turned into the counts it adds (core-table's `contributions`) and
// applied once.
//
// How it tolerates the router's at-least-once, unordered delivery, and so
// duplicate and reordered records and redelivered batches:
// - Duplicates: every change is written with an `EVENT#<eventID>` marker in
//   the same transaction, so a record seen again changes nothing; a learner's
//   activity in a day or week has a `MEMBER#` marker for the same reason, so
//   it is counted once whichever record or event brought it.
// - Order: a count is only ever added to (a status change adds 1 to the new
//   status and -1 to the old), so the sum is the same in any order. A counter
//   may dip below zero while a later event is still on its way; reads clamp
//   it to zero.
// - Lesson funnel: drop-off counts are not deltas of record images. A
//   `progress` change, and an enrolment that starts or stops counting (a
//   drop), only name a student's lesson; `moveLessonFunnel` then moves the
//   count from the status its `FUNNEL#` marker holds to the one the current
//   records give, so any order, repeat or redrive ends at the rebuild's result.
// - Failure: a record that fails does not stop the others in the batch; the
//   batch then throws, the queue delivers it again, and what was applied is
//   skipped by its markers.
export const analyticsUpdate = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
  apply: (change: AnalyticsChange) => Promise<AnalyticsChangeResult>,
  settle: (task: FunnelTask) => Promise<boolean> = async () => false,
): Promise<{ applied: number; skipped: number }> => {
  // Records of one course are applied one after the other: they update the
  // same few items, and concurrent transactions on one item cancel each other.
  const byCourse = new Map<
    string,
    { changes: AnalyticsChange[]; tasks: Map<string, FunnelTask> }
  >();
  const course = (courseId: string) => {
    const found = byCourse.get(courseId) ?? {
      changes: [],
      tasks: new Map<string, FunnelTask>(),
    };
    byCourse.set(courseId, found);
    return found;
  };
  let skipped = 0;
  for (const record of event.Records) {
    const before: Image = record.dynamodb.OldImage;
    const after: Image = record.dynamodb.NewImage;
    const image = after ?? before;
    const entity = image?.__edb_e__;
    const courseId = image?.courseId;
    if (
      typeof entity !== 'string' ||
      typeof courseId !== 'string' ||
      !record.eventID
    ) {
      skipped++;
      continue;
    }
    const { counts, members } = contributionsOfChange(entity, before, after);
    const tasks = funnelTasksOfChange(entity, before, after);
    for (const task of tasks) {
      course(courseId).tasks.set(`${task.userId} ${task.lessonId ?? ''}`, task);
    }
    if (counts.length === 0 && members.length === 0) {
      if (tasks.length === 0) {
        skipped++;
      }
      continue;
    }
    course(courseId).changes.push({
      eventId: record.eventID,
      courseId,
      counts,
      members,
    });
  }

  let applied = 0;
  const failures: unknown[] = [];
  const courses = [...byCourse.values()];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, courses.length) }, async () => {
      while (next < courses.length) {
        const { changes, tasks } = courses[next++];
        for (const change of changes) {
          try {
            if ((await apply(change)) === 'applied') {
              applied++;
            } else {
              skipped++;
            }
          } catch (error) {
            failures.push(error);
          }
        }
        for (const task of tasks.values()) {
          try {
            if (await settle(task)) {
              applied++;
            } else {
              skipped++;
            }
          } catch (error) {
            failures.push(error);
          }
        }
      }
    }),
  );

  logger.info('Applied analytics changes', {
    records: event.Records.length,
    applied,
    skipped,
    failed: failures.length,
  });
  metrics.addMetric('RecordsApplied', MetricUnit.Count, applied);
  metrics.addMetric('RecordsSkipped', MetricUnit.Count, skipped);
  if (failures.length > 0) {
    throw failures[0];
  }
  return { applied, skipped };
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(sqsToStreamRecords())
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(async (event) => {
    const coreTable = await getCoreTable();
    await analyticsUpdate(
      event,
      (change) => applyAnalyticsChange(coreTable, change),
      async ({ courseId, userId, lessonId }) =>
        lessonId
          ? (await moveLessonFunnel(coreTable, {
              courseId,
              userId,
              lessonId,
            })) === 'moved'
          : (await moveStudentFunnels(coreTable, { courseId, userId })) > 0,
    );
  });
