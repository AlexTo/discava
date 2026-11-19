/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { InvalidRequestError } from './errors.js';
import { transactionEntities } from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of a course's learningOutcomes and requirements, so every
// writer trims and bounds them the same way (checked by
// checkCourseLandingShape) and keeps the course's instructors' copy of its
// updatedAt in step (checkInstructorCourseUpdatedAt).

export const LANDING_LIST_MAX_ITEMS = 10;
export const LANDING_ITEM_MAX_LENGTH = 160;

/**
 * Trims each item and returns the list. Throws InvalidRequestError for more
 * than 10 items, or an item that is not 1 to 160 characters once trimmed.
 */
export const normaliseLandingList = (
  items: readonly string[],
  field = 'List',
): string[] => {
  if (items.length > LANDING_LIST_MAX_ITEMS) {
    throw new InvalidRequestError(
      `${field} can have at most ${LANDING_LIST_MAX_ITEMS} items`,
    );
  }
  return items.map((item, index) => {
    const trimmed = item.trim();
    if (trimmed.length < 1 || trimmed.length > LANDING_ITEM_MAX_LENGTH) {
      throw new InvalidRequestError(
        `${field} item ${index + 1} must be 1 to ${LANDING_ITEM_MAX_LENGTH} characters`,
      );
    }
    return trimmed;
  });
};

export interface CourseLandingSet {
  courseId: string;
  learningOutcomes: readonly string[];
  requirements: readonly string[];
  now: Date;
}

export const courseLandingWrites = {
  /**
   * The items of a replacement of both lists: the course patch (an empty list
   * removes the attribute; the course must exist) and, for each instructor of
   * the course, a patch copying the course's new updatedAt to their record.
   * Throws InvalidRequestError for a bad list.
   */
  set: async (
    service: CoreTable,
    { courseId, learningOutcomes, requirements, now }: CourseLandingSet,
  ) => {
    const lists = {
      learningOutcomes: normaliseLandingList(
        learningOutcomes,
        'Learning outcomes',
      ),
      requirements: normaliseLandingList(requirements, 'Requirements'),
    };
    const updatedAt = now.toISOString();

    const { data: instructors } = await service.entities.courseInstructor.query
      .primary({ courseId })
      .go({ pages: 'all' });

    const { course, courseInstructor } = transactionEntities(service);
    const set = Object.fromEntries(
      Object.entries(lists).filter(([, list]) => list.length > 0),
    );
    const remove = Object.entries(lists)
      .filter(([, list]) => list.length === 0)
      .map(([field]) => field);

    return [
      course
        .patch({ courseId })
        .set({ ...set, updatedAt } as never)
        .remove(remove as never)
        .commit(),
      ...instructors.map(({ instructorId }) =>
        courseInstructor
          .patch({ courseId, instructorId })
          .set({ courseUpdatedAt: updatedAt })
          .commit(),
      ),
    ];
  },
};
