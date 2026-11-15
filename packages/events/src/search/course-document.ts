/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CourseDocumentSchema, type ICourseDocument } from '@discava/search';

/** The course fields a document is built from. */
export interface CourseSource {
  courseId: string;
  title?: unknown;
  description?: unknown;
  imageKey?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
}

/**
 * The one place a published course becomes its search document, shared by
 * the stream indexer and the re-index Lambda so the two can't drift.
 */
export const toCourseDocument = (course: CourseSource): ICourseDocument =>
  CourseDocumentSchema.parse({
    courseId: course.courseId,
    title: course.title,
    description: course.description,
    imageKey: course.imageKey,
    status: 'published',
    publishedAt: course.publishedAt ?? course.updatedAt,
    updatedAt: course.updatedAt,
  });
