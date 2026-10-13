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
  CURRICULUM_ENTITIES,
  createCoreTableService,
} from '@discava/core-table';
import middy from '@middy/core';
import { z } from 'zod';
import {
  listEnrolledStudents,
  loadCurriculum,
  recalculateStudent,
} from './recalculate.js';

process.env.POWERTOOLS_METRICS_NAMESPACE = 'ProgressRecalculation';
process.env.POWERTOOLS_SERVICE_NAME = 'ProgressRecalculation';

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

// How many students are recalculated at once.
const CONCURRENCY = 10;

// The curriculum entities whose changes the event source mapping lets
// through, alongside new item completions: see
// CoreApiStack.createProgressRecalculationLambda for the filters. ElectroDB
// stores each record's entity name in `__edb_e__`.
const curriculumEntities = new Set<string>(CURRICULUM_ENTITIES);

type StreamRecord = z.infer<typeof DynamoDBStreamSchema>['Records'][number];
type Image = Record<string, unknown> | undefined;

// What a student sees of a module, lesson or content item changed: it was
// shown or hidden, archived or restored, or removed. Any other edit (a title,
// an order, a studentActivityCount) leaves progress as it was.
const changesWhatStudentsSee = (record: StreamRecord) => {
  if (record.eventName === 'REMOVE') {
    return true;
  }
  const before: Image = record.dynamodb.OldImage;
  const after: Image = record.dynamodb.NewImage;
  return (
    before?.visibility !== after?.visibility ||
    before?.archivedAt !== after?.archivedAt
  );
};

// The students to recalculate, per course: the student of each completion
// recorded, and everyone enrolled in a course whose visible curriculum
// changed. Each is recalculated once per batch, however many records name
// them.
export const studentsToRecalculate = async (
  records: StreamRecord[],
  listStudents: (courseId: string) => Promise<string[]>,
) => {
  const studentsByCourse = new Map<string, Set<string>>();
  const add = (courseId: string, userIds: string[]) => {
    const students = studentsByCourse.get(courseId) ?? new Set<string>();
    for (const userId of userIds) {
      students.add(userId);
    }
    studentsByCourse.set(courseId, students);
  };

  const changedCourses = new Set<string>();
  for (const record of records) {
    const image: Image = record.dynamodb.NewImage ?? record.dynamodb.OldImage;
    const entity = image?.__edb_e__;
    if (entity === 'itemCompletion' && record.eventName === 'INSERT') {
      add(String(image?.courseId), [String(image?.userId)]);
    } else if (
      typeof entity === 'string' &&
      curriculumEntities.has(entity) &&
      changesWhatStudentsSee(record)
    ) {
      changedCourses.add(String(image?.courseId));
    }
  }
  for (const courseId of changedCourses) {
    add(courseId, await listStudents(courseId));
  }
  return studentsByCourse;
};

// Runs `task` for every item, at most `limit` at a time.
const forEachLimited = async <T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        await task(items[next++]);
      }
    }),
  );
};

// The single writer of lesson progress and of the enrolment's
// progressPercent, status and completedAt. Every run recomputes from scratch,
// so a duplicate stream record or a burst of edits only produces the same
// result again. A failure fails the batch, which the event source mapping
// retries.
export const progressRecalculation = async (
  event: z.infer<typeof DynamoDBStreamSchema>,
): Promise<void> => {
  const coreTable = await getCoreTable();
  const studentsByCourse = await studentsToRecalculate(event.Records, (id) =>
    listEnrolledStudents(coreTable, id),
  );

  let recalculated = 0;
  for (const [courseId, students] of studentsByCourse) {
    // Loaded once per course for the whole batch.
    const curriculum = await loadCurriculum(coreTable, courseId);
    await forEachLimited([...students], CONCURRENCY, async (userId) => {
      await recalculateStudent(coreTable, courseId, curriculum, userId);
      recalculated++;
    });
  }
  logger.info('Recalculated progress', {
    records: event.Records.length,
    courses: studentsByCourse.size,
    students: recalculated,
  });
  metrics.addMetric('StudentsRecalculated', MetricUnit.Count, recalculated);
};

export const handler = middy()
  .use(captureLambdaHandler(tracer))
  .use(injectLambdaContext(logger))
  .use(logMetrics(metrics))
  .use(parser({ schema: DynamoDBStreamSchema }))
  .handler(progressRecalculation);
