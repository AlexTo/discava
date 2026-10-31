/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createCoreTableService } from '@discava/core-table';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import {
  CourseDocumentSchema,
  type ICourseDocument,
} from '../indices/courses.js';

/**
 * Re-indexes every published course from the core table. The stream (packages/events/src/search/index-content.ts) only
 * carries changes made after an index's mapping is created, so this is what
 * populates a freshly created index, or repairs one after an indexing bug.
 * Idempotent: every document id is the entity's own key, so running it twice
 * just overwrites the same documents.
 */
export const backfill = async (): Promise<{ courses: number }> => {
  const [coreTable, client] = await Promise.all([
    createCoreTableService(),
    getOpenSearchClient(),
  ]);

  let courses = 0;
  let cursor: string | null | undefined;
  do {
    const { data: page, cursor: nextCursor } =
      await coreTable.entities.course.query
        .byStatus({ status: 'published' })
        .go({ cursor });

    for (const course of page) {
      const doc: ICourseDocument = CourseDocumentSchema.parse({
        courseId: course.courseId,
        title: course.title,
        description: course.description,
        status: 'published',
        publishedAt: course.publishedAt ?? course.updatedAt,
        updatedAt: course.updatedAt,
      });
      await client.index({
        index: resolveIndexName('courses'),
        id: doc.courseId,
        body: doc,
      });
      courses++;
    }
    cursor = nextCursor;
  } while (cursor);

  return { courses };
};
