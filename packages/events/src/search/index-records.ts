/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCoreTableService } from '@discava/core-table';
import { getOpenSearchClient, resolveIndexName } from '@discava/search';
import {
  contentItemDoc,
  courseDoc,
  type LessonRecord,
  lessonDoc,
  type ModuleRecord,
  moduleDoc,
  userDoc,
} from './documents.js';

// The core table service, as createCoreTableService returns it.
type CoreTableService = Awaited<ReturnType<typeof createCoreTableService>>;
// The OpenSearch client, as the search package's factory returns it; events
// never names the opensearch package itself, only what @discava/search hands
// back.
type OpenSearchClient = Awaited<ReturnType<typeof getOpenSearchClient>>;
// The stream fields a record carries, as the indexer reads them: the new or
// old image. The handler's parser (DynamoDBStreamSchema) has already turned
// each DynamoDB attribute into its plain value, so the image is a map of
// attribute name to plain value — the progress recalculation reads its records
// the same way (not as DynamoDB attribute maps).
type SearchStreamRecord = {
  dynamodb?: {
    NewImage?: Record<string, unknown> | undefined;
    OldImage?: Record<string, unknown> | undefined;
  };
};

// The index names, resolved once so the core can be pointed at local dev's
// prefixed names or the deployed collection's bare names without the callers
// knowing (see resolveIndexName).
const indexNames = () => ({
  courses: resolveIndexName('courses'),
  modules: resolveIndexName('modules'),
  lessons: resolveIndexName('lessons'),
  contentItems: resolveIndexName('content-items'),
  users: resolveIndexName('users'),
});

/**
 * Which courses and users a batch of stream records may have changed. A course
 * record names itself; a module, lesson or content item names its course.
 * Modules have no index of their own, but a module's edit changes its
 * lessons' and content items' documents, so a module record reindexes the
 * whole course. Returns nothing for records that reach the indexer by mistake
 * (the event source mapping and the local event runner filter first).
 */
export const searchTargetsFromRecords = (
  records: SearchStreamRecord[],
): { courseIds: Set<string>; userIds: Set<string> } => {
  const courseIds = new Set<string>();
  const userIds = new Set<string>();
  for (const record of records) {
    const image = record.dynamodb?.NewImage ?? record.dynamodb?.OldImage;
    // The parser hands the image's values over as plain values, not DynamoDB
    // attribute maps (see SearchStreamRecord), so read them directly.
    const entity =
      typeof image?.__edb_e__ === 'string' ? image.__edb_e__ : undefined;
    const courseId =
      typeof image?.courseId === 'string' ? image.courseId : undefined;
    const userId = typeof image?.userId === 'string' ? image.userId : undefined;
    if (
      entity === 'course' ||
      entity === 'module' ||
      entity === 'lesson' ||
      entity === 'contentItem'
    ) {
      if (courseId) courseIds.add(courseId);
    } else if (entity === 'user') {
      if (userId) userIds.add(userId);
    }
  }
  return { courseIds, userIds };
};

// The course's curriculum loaded once for the whole reindex: its course and
// every module, lesson and content item, the raw items the document builders
// take. `pages: 'all'` because a course can exceed a single query page.
const loadCourse = async (coreTable: CoreTableService, courseId: string) => {
  const { data } = await coreTable.collections
    .curriculum({ courseId })
    .go({ pages: 'all' });
  return data;
};

// Reindexes one course from scratch. It first clears the course's current
// documents, then writes back the ones the table holds now: a bulk of index
// actions only overwrites the documents it names, so without the clear, a
// lesson or content item deleted from the table would linger in the index.
// Every document is keyed by its own id, so a replay or a duplicate record
// rewrites the same documents and the result is the same again (the indexer
// is the single writer of the course's documents, like the progress
// recalculation is of the progress). `ignore: [404]` makes a not-yet-created
// index a no-op, not an error.
export const reindexCourse = async ({
  coreTable,
  client,
  indexNames: names,
  courseId,
}: {
  coreTable: CoreTableService;
  client: OpenSearchClient;
  indexNames: ReturnType<typeof indexNames>;
  courseId: string;
}): Promise<void> => {
  for (const index of [names.modules, names.lessons, names.contentItems]) {
    await client.deleteByQuery(
      { index, body: { query: { term: { courseId } } } },
      { ignore: [404] },
    );
  }
  await client.delete(
    { index: names.courses, id: courseId },
    { ignore: [404] },
  );

  const data = await loadCourse(coreTable, courseId);
  const [course] = data.course;
  if (!course) {
    // The course was removed: its documents are already cleared.
    return;
  }

  const modulesByModuleId = new Map<string, ModuleRecord>(
    data.module.map((module) => [module.moduleId, module]),
  );
  const lessonsByLessonId = new Map<string, LessonRecord>(
    data.lesson.map((lesson) => [lesson.lessonId, lesson]),
  );

  // One bulk per course: the course's document, then its modules', lessons'
  // and content items' documents. A record whose parent is gone (shouldn't
  // happen, but the table is the source of truth) is skipped rather than
  // written with a dangling reference.
  const actions: Record<string, unknown>[] = [
    { index: { _index: names.courses, _id: course.courseId } },
    courseDoc(course),
  ];
  for (const module of data.module) {
    actions.push(
      { index: { _index: names.modules, _id: module.moduleId } },
      moduleDoc(module, course),
    );
  }
  for (const lesson of data.lesson) {
    const module = modulesByModuleId.get(lesson.moduleId);
    if (!module) continue;
    actions.push(
      { index: { _index: names.lessons, _id: lesson.lessonId } },
      lessonDoc(lesson, module, course),
    );
  }
  for (const item of data.contentItem) {
    const lesson = lessonsByLessonId.get(item.lessonId);
    if (!lesson) continue;
    actions.push(
      { index: { _index: names.contentItems, _id: item.contentItemId } },
      contentItemDoc(item, lesson, course),
    );
  }
  await client.bulk({ body: actions, refresh: true });
};

// Reindexes one user from scratch: the current record, or nothing if it's
// gone. A user's document is small, so a single index (or delete) is enough.
export const reindexUser = async ({
  coreTable,
  client,
  indexNames: names,
  userId,
}: {
  coreTable: CoreTableService;
  client: OpenSearchClient;
  indexNames: ReturnType<typeof indexNames>;
  userId: string;
}): Promise<void> => {
  const { data: user } = await coreTable.entities.user.get({ userId }).go();
  if (!user) {
    await client.delete({ index: names.users, id: userId }, { ignore: [404] });
    return;
  }
  await client.index({
    index: names.users,
    id: user.userId,
    body: userDoc(user),
  });
};

// The batch of work: reindex each affected course and user once, however many
// records named them. Runs after the event source mapping (or the local event
// runner) has filtered the batch to SEARCH_STREAM_FILTERS, so only the indexed
// content types and users reach here.
export const indexRecords = async ({
  coreTable,
  records,
}: {
  coreTable: CoreTableService;
  records: SearchStreamRecord[];
}): Promise<{ courses: number; users: number }> => {
  const client = await getOpenSearchClient();
  const names = indexNames();
  const { courseIds, userIds } = searchTargetsFromRecords(records);
  let courses = 0;
  for (const courseId of courseIds) {
    await reindexCourse({ coreTable, client, indexNames: names, courseId });
    courses++;
  }
  let users = 0;
  for (const userId of userIds) {
    await reindexUser({ coreTable, client, indexNames: names, userId });
    users++;
  }
  return { courses, users };
};
