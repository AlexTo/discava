/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type CoreTable, isShown } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { getEnrolment, requireEnrolment } from '../procedures/enrolment.js';
import type { ILessonRef } from '../schema/index.js';

const INSTRUCTOR_GROUP = 'instructor';
const NOT_AVAILABLE = 'This lesson is not available';

/**
 * Who may open a lesson's discussion (contracts/core-api-discussion.md):
 * an instructor of the course (in the `instructor` group, with a
 * `courseInstructor` record for it) on any lesson that exists, or a student
 * with a non-dropped enrolment on a lesson shown to students. Everyone else
 * is refused as `requireEnrolment` refuses them. A `moduleId` that does not
 * hold the lesson is NOT_FOUND.
 *
 * `lessonMustBeShown: false` is for a student's own deleting, which needs
 * only access to the course, not an open lesson.
 */
export const requireDiscussionAccess = async (
  coreTable: CoreTable,
  user: { sub: string; groups: string[] },
  { courseId, moduleId, lessonId }: ILessonRef,
  { lessonMustBeShown = true }: { lessonMustBeShown?: boolean } = {},
) => {
  const { sub, groups } = user;
  const [
    { data: course },
    { data: module },
    { data: lesson },
    enrolment,
    instructorRecord,
  ] = await Promise.all([
    coreTable.entities.course.get({ courseId }).go(),
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
    getEnrolment(coreTable, courseId, sub),
    groups.includes(INSTRUCTOR_GROUP)
      ? coreTable.entities.courseInstructor
          .get({ courseId, instructorId: sub })
          .go()
          .then(({ data }) => data)
      : Promise.resolve(null),
  ]);
  if (!course) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  const isInstructor = Boolean(instructorRecord);
  if (!isInstructor) {
    requireEnrolment(course, enrolment);
  }
  if (!module || !lesson) {
    throw new TRPCError({ code: 'NOT_FOUND', message: NOT_AVAILABLE });
  }
  if (
    !isInstructor &&
    lessonMustBeShown &&
    (!isShown(module) || !isShown(lesson))
  ) {
    throw new TRPCError({ code: 'NOT_FOUND', message: NOT_AVAILABLE });
  }
  return { course, module, lesson, isInstructor };
};

export type DiscussionAccess = Awaited<
  ReturnType<typeof requireDiscussionAccess>
>;
