/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ratingAverage,
  ratingBoost,
  ratingCount,
  type StarField,
  starCounts,
  weightedRating,
} from '@discava/core-table';
import { CourseDocumentSchema, type ICourseDocument } from '@discava/search';

/** The course fields a document is built from. */
export interface CourseSource {
  courseId: string;
  title?: unknown;
  description?: unknown;
  imageKey?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
  categoryId?: unknown;
  tags?: unknown;
  level?: unknown;
  language?: unknown;
  durationHours?: unknown;
}

/** A course's `courseRating` record; absent when nobody has rated it. */
export type CourseRatingSource = Partial<Record<StarField, number>>;

// Rounded as the API rounds the average it returns (one decimal), so a
// `minRating` filter agrees with the figure a card shows.
const roundedAverage = (average: number) => Math.round(average * 10) / 10;

const ratingFields = (rating?: CourseRatingSource) => {
  const stars = starCounts(rating);
  const count = ratingCount(stars);
  if (count === 0) {
    return { ratingBoost: 1 };
  }
  return {
    ratingCount: count,
    ratingAverage: roundedAverage(ratingAverage(stars)!),
    ratingScore: weightedRating(stars),
    ratingBoost: ratingBoost(stars),
  };
};

/**
 * The one place a published course becomes its search document, shared by
 * the stream indexer and the re-index Lambda so the two can't drift.
 */
export const toCourseDocument = (
  course: CourseSource,
  rating?: CourseRatingSource,
): ICourseDocument =>
  CourseDocumentSchema.parse({
    courseId: course.courseId,
    title: course.title,
    description: course.description,
    imageKey: course.imageKey,
    status: 'published',
    publishedAt: course.publishedAt ?? course.updatedAt,
    updatedAt: course.updatedAt,
    categoryId: course.categoryId,
    tags: course.tags,
    level: course.level,
    language: course.language,
    durationHours: course.durationHours,
    ...ratingFields(rating),
  });
