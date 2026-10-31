/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createCoreTableService } from '@discava/core-table';
import type { Client } from '@opensearch-project/opensearch';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import {
  CourseDocumentSchema,
  type ICourseDocument,
} from '../indices/courses.js';

// How many documents a single _bulk call carries, for both indexing (one
// batch per core-table page) and the stale-id scan below. Keeps each request
// a reasonable size without needing to tune it against real data yet.
const BATCH_SIZE = 500;

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

// Every id currently in the index, read with `search_after` rather than the
// scroll API: OpenSearch Serverless doesn't support scroll, only deep
// pagination by sort value. Sorting by `_id` needs no mapping of its own, so
// this works before and after a mapping change.
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
    const hits = body.hits.hits as {
      _id: string;
      sort: (string | number)[];
    }[];
    ids.push(...hits.map((hit) => hit._id));
    if (hits.length < BATCH_SIZE) {
      return ids;
    }
    searchAfter = hits[hits.length - 1]!.sort;
  }
};

/**
 * Re-indexes every published course from the core table, and removes any
 * document the index still has for a course that isn't published any more --
 * one unpublished while the indexer itself was down would otherwise keep
 * showing up in search, since its document still says `status: 'published'`
 * (#267). The stream (packages/events/src/search/index-content.ts) only
 * carries changes made after an index's mapping is created, so this is what
 * populates a freshly created index, or repairs one after an indexing bug.
 * Idempotent: every document id is the entity's own key, so running it twice
 * just overwrites or re-deletes the same documents.
 */
export const backfill = async (): Promise<{
  courses: number;
  removed: number;
}> => {
  const [coreTable, client] = await Promise.all([
    createCoreTableService(),
    getOpenSearchClient(),
  ]);
  const index = resolveIndexName('courses');

  let courses = 0;
  const publishedIds = new Set<string>();
  let cursor: string | null | undefined;
  do {
    const { data: page, cursor: nextCursor } =
      await coreTable.entities.course.query
        .byStatus({ status: 'published' })
        .go({ cursor });

    if (page.length > 0) {
      const body = page.flatMap((course) => {
        const doc: ICourseDocument = CourseDocumentSchema.parse({
          courseId: course.courseId,
          title: course.title,
          description: course.description,
          status: 'published',
          publishedAt: course.publishedAt ?? course.updatedAt,
          updatedAt: course.updatedAt,
        });
        publishedIds.add(doc.courseId);
        return [{ index: { _index: index, _id: doc.courseId } }, doc];
      });
      assertNoBulkErrors((await client.bulk({ body })).body);
      courses += page.length;
    }
    cursor = nextCursor;
  } while (cursor);

  const staleIds = (await indexedCourseIds(client, index)).filter(
    (id) => !publishedIds.has(id),
  );
  for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
    const batch = staleIds.slice(i, i + BATCH_SIZE);
    assertNoBulkErrors(
      (
        await client.bulk({
          body: batch.map((id) => ({ delete: { _index: index, _id: id } })),
        })
      ).body,
    );
  }

  return { courses, removed: staleIds.length };
};
