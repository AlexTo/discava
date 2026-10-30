/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type AttributeValue, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  createCoreTableService,
  getDynamoDBClient,
  resolveTableName,
} from '@discava/core-table';
import { getOpenSearchClient, resolveIndexName } from '@discava/search';
import { reindexCourse, reindexUser } from './index-records.js';

// The core table service, as createCoreTableService returns it.
type CoreTableService = Awaited<ReturnType<typeof createCoreTableService>>;
// The OpenSearch client, as the search package's factory returns it.
type OpenSearchClient = Awaited<ReturnType<typeof getOpenSearchClient>>;
// The index names the reindex functions take (the same shape index-records
// builds), resolved once so a backfill writes to the same indices as the
// stream indexer does.
const indexNames = () => ({
  courses: resolveIndexName('courses'),
  modules: resolveIndexName('modules'),
  lessons: resolveIndexName('lessons'),
  contentItems: resolveIndexName('content-items'),
  users: resolveIndexName('users'),
});

// A core-table item as a scan returns it: an attribute map, only the `S`
// values read. ElectroDB names the entity's type `__edb_e__`.
type ScanItem = Record<string, AttributeValue | undefined>;

/**
 * Which courses and users a batch of core-table items names: a course item
 * names its `courseId`, a user item its `userId`. Anything else is ignored
 * (the stream indexer's reindex functions need only these two ids to rebuild
 * each document set).
 */
export const backfillTargetsFromItems = (
  items: ScanItem[],
): { courseIds: string[]; userIds: string[] } => {
  const courseIds: string[] = [];
  const userIds: string[] = [];
  for (const item of items) {
    const entity = item.__edb_e__?.S;
    if (entity === 'course' && item.courseId?.S)
      courseIds.push(item.courseId.S);
    else if (entity === 'user' && item.userId?.S) userIds.push(item.userId.S);
  }
  // De-duplicate, keeping scan order: the table holds each id once, but a
  // backfill over a partitioned scan can still see an id twice.
  return {
    courseIds: [...new Set(courseIds)],
    userIds: [...new Set(userIds)],
  };
};

// Scans the whole table for the backfill's entity types and returns their
// ids. A scan (not a query) is used because the entity types live in many
// partitions; the FilterExpression keeps DynamoDB returning only the relevant
// items, and the scan pages until it's exhausted.
const scanBackfillTargets = async (): Promise<{
  courseIds: string[];
  userIds: string[];
}> => {
  const client = getDynamoDBClient();
  const tableName = await resolveTableName();
  const courseIds: string[] = [];
  const userIds: string[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const { Items, LastEvaluatedKey } = await client.send(
      new ScanCommand({
        TableName: tableName,
        // `__edb_e__` isn't a legal identifier, so it goes through an
        // expression attribute name.
        FilterExpression: '#e = :course OR #e = :user',
        ExpressionAttributeNames: { '#e': '__edb_e__' },
        ExpressionAttributeValues: {
          ':course': { S: 'course' },
          ':user': { S: 'user' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    const targets = backfillTargetsFromItems(Items ?? []);
    courseIds.push(...targets.courseIds);
    userIds.push(...targets.userIds);
    lastKey = LastEvaluatedKey;
  } while (lastKey);
  return {
    courseIds: [...new Set(courseIds)],
    userIds: [...new Set(userIds)],
  };
};

/**
 * Reindexes every course and user in the core table from the table's current
 * state, so the search index matches what the table holds now. The stream
 * indexer only reacts to changes, so the documents that existed before it was
 * deployed are never indexed on their own; this backfills them. It reuses the
 * stream indexer's reindex functions, so a backfilled index and one built by
 * the stream hold the same documents.
 */
export const backfillSearchIndexes = async ({
  coreTable,
}: {
  coreTable: CoreTableService;
}): Promise<{ courses: number; users: number }> => {
  const client: OpenSearchClient = await getOpenSearchClient();
  const names = indexNames();
  const { courseIds, userIds } = await scanBackfillTargets();
  for (const courseId of courseIds) {
    await reindexCourse({ coreTable, client, indexNames: names, courseId });
  }
  for (const userId of userIds) {
    await reindexUser({ coreTable, client, indexNames: names, userId });
  }
  return { courses: courseIds.length, users: userIds.length };
};
