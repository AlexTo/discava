/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createCoreTableService,
  filterEffectivelyVisible,
} from '@discava/core-table';
import { getOpenSearchClient, resolveIndexName } from '../client.js';
import {
  CourseDocumentSchema,
  type ICourseDocument,
} from '../indices/courses.js';
import {
  type ILessonDocument,
  LessonDocumentSchema,
} from '../indices/lessons.js';

/**
 * Re-indexes every published course and effectively visible lesson from the
 * core table. The stream (packages/events/src/search/index-content.ts) only
 * carries changes made after an index's mapping is created, so this is what
 * populates a freshly created index, or repairs one after an indexing bug.
 * Idempotent: every document id is the entity's own key, so running it twice
 * just overwrites the same documents.
 */
export const backfill = async (): Promise<{
  courses: number;
  lessons: number;
}> => {
  const [coreTable, client] = await Promise.all([
    createCoreTableService(),
    getOpenSearchClient(),
  ]);

  let courses = 0;
  let lessons = 0;
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

      const { data } = await coreTable.collections
        .curriculum({ courseId: course.courseId })
        .go({ pages: 'all' });
      const { lessons: visibleLessons } = filterEffectivelyVisible({
        modules: data.module,
        lessons: data.lesson,
        contentItems: [],
      });
      for (const lesson of visibleLessons) {
        const lessonDoc: ILessonDocument = LessonDocumentSchema.parse({
          lessonId: lesson.lessonId,
          moduleId: lesson.moduleId,
          courseId: lesson.courseId,
          title: lesson.title,
          description: lesson.description,
          updatedAt: lesson.updatedAt,
        });
        await client.index({
          index: resolveIndexName('lessons'),
          id: lessonDoc.lessonId,
          body: lessonDoc,
        });
        lessons++;
      }
    }
    cursor = nextCursor;
  } while (cursor);

  return { courses, lessons };
};
