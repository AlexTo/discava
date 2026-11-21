/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isCaptionLanguage } from '@discava/common-web-utils/caption-languages';
import type { createCoreTableService } from '../service.js';
import {
  DURATION_HOURS_MAX,
  DURATION_HOURS_MIN,
  LANGUAGES,
  type Language,
  LEVELS,
  type Level,
  normaliseTags,
} from './catalogue-vocabulary.js';
import {
  failedConditions,
  InvalidRequestError,
  NotFoundError,
} from './errors.js';
import { transactionEntities } from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of a course's catalogue fields (categoryId, tags, level,
// language, durationHours), so every writer normalises and validates them the
// same way and keeps the rule checked by checkCourseCategoryExists: a course
// only points at a category that exists, and only newly at one that is active.

export interface CourseCatalogue {
  categoryId?: string;
  tags?: string[];
  level?: Level;
  language?: Language;
  durationHours?: number;
}

/** Most caption languages a course can have: ten less its source language. */
export const MAX_CAPTION_LANGUAGES = 9;

const FIELDS = [
  'categoryId',
  'tags',
  'level',
  'language',
  'durationHours',
] as const;

// Every writer of a course copies its new updatedAt to its instructors'
// records (the by-recency listing sorts on it; checked by
// checkInstructorCourseUpdatedAt). ElectroDB sets updatedAt at write time and
// a transaction doesn't return it, so read the course back.
const refreshInstructorCourseUpdatedAt = async (
  service: CoreTable,
  courseId: string,
) => {
  const { data: course } = await service.entities.course.get({ courseId }).go();
  if (!course) {
    return;
  }
  const { data: instructors } = await service.entities.courseInstructor.query
    .primary({ courseId })
    .go({ pages: 'all' });
  await Promise.all(
    instructors.map(({ instructorId }) =>
      service.entities.courseInstructor
        .patch({ courseId, instructorId })
        .set({ courseUpdatedAt: course.updatedAt })
        .go(),
    ),
  );
};

/**
 * Replaces a course's catalogue fields: an omitted field is removed. A
 * category must exist and be active, unless it is the course's current one
 * (so saving other fields of a course in an archived category works).
 * Throws InvalidRequestError for a bad value or category, NotFoundError for
 * an unknown course.
 */
export const courseCatalogueWrites = async (
  service: CoreTable,
  { courseId, ...catalogue }: CourseCatalogue & { courseId: string },
) => {
  const tags =
    catalogue.tags === undefined ? undefined : normaliseTags(catalogue.tags);
  const { level, language, durationHours, categoryId } = catalogue;
  if (level !== undefined && !LEVELS.includes(level)) {
    throw new InvalidRequestError('Unknown level');
  }
  if (language !== undefined && !LANGUAGES.includes(language)) {
    throw new InvalidRequestError('Unknown language');
  }
  if (
    durationHours !== undefined &&
    !(
      Number.isInteger(durationHours) &&
      durationHours >= DURATION_HOURS_MIN &&
      durationHours <= DURATION_HOURS_MAX
    )
  ) {
    throw new InvalidRequestError(
      `Duration must be a whole number of hours, ${DURATION_HOURS_MIN} to ${DURATION_HOURS_MAX}`,
    );
  }

  const { data: course } = await service.entities.course.get({ courseId }).go();
  if (!course) {
    throw new NotFoundError('Course not found');
  }

  const values = { categoryId, tags, level, language, durationHours };
  const set = Object.fromEntries(
    FIELDS.filter((field) => values[field] !== undefined).map((field) => [
      field,
      values[field],
    ]),
  );
  const remove = FIELDS.filter((field) => values[field] === undefined);

  const { course: courseItem, category } = transactionEntities(service);
  const patch = (entity: typeof courseItem) =>
    entity
      .patch({ courseId })
      .set(set as never)
      .remove(remove as never);

  // Only a new category must be active; keeping the current one never fails.
  if (categoryId === undefined || categoryId === course.categoryId) {
    await service.entities.course
      .patch({ courseId })
      .set(set as never)
      .remove(remove as never)
      .go();
    await refreshInstructorCourseUpdatedAt(service, courseId);
    return;
  }
  const { canceled, data: results } = await service.transaction
    .write(() => [
      patch(courseItem).commit(),
      category
        .check({ categoryId })
        .where((attr, op) => op.eq(attr.status, 'active'))
        .commit(),
    ])
    .go();
  if (canceled) {
    const failed = failedConditions(results);
    throw failed[1]
      ? new InvalidRequestError('Choose an active category')
      : new NotFoundError('Course not found');
  }
  await refreshInstructorCourseUpdatedAt(service, courseId);
};

/**
 * Sets the languages a course's videos are translated into, in the given
 * order (removing the attribute for an empty list). The only writer of
 * `captionLanguages`; it leaves the catalogue fields alone. Throws
 * InvalidRequestError for an unknown tag, a duplicate or more than
 * min(9, maxLanguages) languages, NotFoundError for an unknown course.
 */
export const setCourseCaptionLanguages = async (
  service: CoreTable,
  {
    courseId,
    languages,
    maxLanguages,
  }: { courseId: string; languages: readonly string[]; maxLanguages: number },
) => {
  const limit = Math.min(MAX_CAPTION_LANGUAGES, maxLanguages);
  if (!languages.every(isCaptionLanguage)) {
    throw new InvalidRequestError('Unknown caption language');
  }
  if (new Set(languages).size !== languages.length) {
    throw new InvalidRequestError('Each caption language can be chosen once');
  }
  if (languages.length > limit) {
    throw new InvalidRequestError(`Choose at most ${limit} caption languages`);
  }
  const { data: course } = await service.entities.course.get({ courseId }).go();
  if (!course) {
    throw new NotFoundError('Course not found');
  }
  const patch = service.entities.course.patch({ courseId });
  await (languages.length === 0
    ? patch.remove(['captionLanguages'])
    : patch.set({ captionLanguages: [...languages] })
  ).go();
  await refreshInstructorCourseUpdatedAt(service, courseId);
};
