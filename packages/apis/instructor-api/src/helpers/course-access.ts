/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CoreTable } from '@discava/core-table';
import { TRPCError } from '@trpc/server';

// Only instructors teaching this specific course may change its curriculum,
// not just any member of the instructor group.
export const requireCourseInstructor = async (
  coreTable: CoreTable,
  courseId: string,
  instructorId: string,
) => {
  const { data: membership } = await coreTable.entities.courseInstructor
    .get({ courseId, instructorId })
    .go();
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
};

// byInstructor's sort key is courseUpdatedAt#courseId, so every course
// update has to refresh that denormalized timestamp on every
// CourseInstructor row for the course, not just the caller's own.
export const refreshInstructorCourseUpdatedAt = async (
  coreTable: CoreTable,
  courseId: string,
  courseUpdatedAt: string,
) => {
  const { data: instructors } = await coreTable.entities.courseInstructor.query
    .primary({ courseId })
    .go();
  await Promise.all(
    instructors.map(({ instructorId }) =>
      coreTable.entities.courseInstructor
        .patch({ courseId, instructorId })
        .set({ courseUpdatedAt })
        .go(),
    ),
  );
};

export const getCourseOrThrow = async (
  coreTable: CoreTable,
  courseId: string,
) => {
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  if (!course) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  return course;
};
