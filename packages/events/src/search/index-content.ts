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
import { createCoreTableService, isShown } from '@discava/core-table';
import {
  CourseDocumentSchema,
  getOpenSearchClient,
  type IndexName,
  LessonDocumentSchema,
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

// Memoized across invocations on a warm Lambda, as the other handlers.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;
const getCoreTable = () => {
  if (!coreTablePromise) {
    coreTablePromise = createCoreTableService();
  }
  return coreTablePromise;
};

type StreamRecord = z.infer<typeof DynamoDBStreamSchema>['Records'][number];
type Image = Record<string, unknown> | undefined;
type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

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

// A lesson's doc exists only while it's effectively visible (itself, its
// module, and its course all pass), matching what a student-facing read
// shows -- see filterEffectivelyVisible. The record carries the lesson's own
// state; its module and course aren't on it, so both are looked up.
const indexOrDeleteLesson = async (
  coreTable: CoreTable,
  client: Client,
  record: StreamRecord,
) => {
  if (record.eventName === 'REMOVE') {
    const old: Image = record.dynamodb.OldImage;
    return deleteDoc(client, 'lessons', String(old?.lessonId));
  }
  const image: Image = record.dynamodb.NewImage;
  const lessonId = String(image?.lessonId);
  const moduleId = String(image?.moduleId);
  const courseId = String(image?.courseId);
  const lessonShown = isShown({
    visibility: image?.visibility as 'hidden' | 'visible',
    archivedAt: image?.archivedAt as string | undefined,
  });

  const [{ data: module }, { data: course }] = await Promise.all([
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    coreTable.entities.course.get({ courseId }).go(),
  ]);

  if (
    lessonShown &&
    module &&
    isShown(module) &&
    course?.status === 'published'
  ) {
    const doc = LessonDocumentSchema.parse({
      lessonId,
      moduleId,
      courseId,
      title: image?.title,
      description: image?.description,
      updatedAt: image?.updatedAt,
    });
    await client.index({
      index: resolveIndexName('lessons'),
      id: lessonId,
      body: doc,
    });
  } else {
    await deleteDoc(client, 'lessons', lessonId);
  }
};

// A module's own record never has a doc; its visibility and archivedAt
// decide every one of its lessons' effective visibility, so an edit here
// reconciles each of them (a module change doesn't say which lessons it
// has). A module's own removal needs nothing here: its lessons are removed
// too, each by their own REMOVE record.
const reconcileLessonsUnderModule = async (
  coreTable: CoreTable,
  client: Client,
  record: StreamRecord,
) => {
  if (record.eventName === 'REMOVE') {
    return;
  }
  const image: Image = record.dynamodb.NewImage;
  const courseId = String(image?.courseId);
  const moduleId = String(image?.moduleId);
  const moduleShown = isShown({
    visibility: image?.visibility as 'hidden' | 'visible',
    archivedAt: image?.archivedAt as string | undefined,
  });

  const [{ data: lessons }, { data: course }] = await Promise.all([
    coreTable.entities.lesson.query.primary({ courseId, moduleId }).go(),
    coreTable.entities.course.get({ courseId }).go(),
  ]);
  const coursePublished = course?.status === 'published';

  for (const lesson of lessons) {
    if (moduleShown && coursePublished && isShown(lesson)) {
      const doc = LessonDocumentSchema.parse({
        lessonId: lesson.lessonId,
        moduleId: lesson.moduleId,
        courseId: lesson.courseId,
        title: lesson.title,
        description: lesson.description,
        updatedAt: lesson.updatedAt,
      });
      await client.index({
        index: resolveIndexName('lessons'),
        id: lesson.lessonId,
        body: doc,
      });
    } else {
      await deleteDoc(client, 'lessons', lesson.lessonId);
    }
  }
};

const entityOf = (record: StreamRecord): string | undefined => {
  const image: Image = record.dynamodb.NewImage ?? record.dynamodb.OldImage;
  return image?.__edb_e__ as string | undefined;
};

// Keeps the courses and lessons indices in step with the core table.
// Idempotent (every document id is the entity's own key) and safe to retry
// or replay: every record is re-derived from the table's current state
// rather than applied as a diff, the same philosophy as progress
// recalculation.
export const searchIndexing = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
): Promise<void> => {
  const [coreTable, client] = await Promise.all([
    getCoreTable(),
    getOpenSearchClient(),
  ]);

  for (const record of event.Records) {
    switch (entityOf(record)) {
      case 'course':
        await indexOrDeleteCourse(client, record);
        break;
      case 'lesson':
        await indexOrDeleteLesson(coreTable, client, record);
        break;
      case 'module':
        await reconcileLessonsUnderModule(coreTable, client, record);
        break;
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
