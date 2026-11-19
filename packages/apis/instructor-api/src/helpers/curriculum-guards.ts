/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CoreTable } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import type { ICurriculumVisibility } from '../schema/index.js';
import type { TransactionEntities } from './ancestor-writes.js';
import { getCourseOrThrow } from './course-access.js';

// A draft course has never been open to students, so its curriculum is
// edited freely: new records are visible straight away and delete is
// permanent. A published or archived course may have students with
// progress or attempts, so new records start hidden until published and
// delete archives instead.
export const isDraftCourse = (course: { status: string }) =>
  course.status === 'draft';

// A record's visibility when it's created, and its `publishedAt` if that
// makes it visible straight away (see firstPublishedAt).
export const initialVisibilityFields = (course: {
  status: string;
}): { visibility: ICurriculumVisibility; publishedAt?: string } =>
  isDraftCourse(course)
    ? { visibility: 'visible', publishedAt: new Date().toISOString() }
    : { visibility: 'hidden' };

// `publishedAt` records the first time a module, lesson or content item
// became visible, and is never cleared. Publishing a parent publishes only
// hidden descendants that have never been published -- content that's new --
// so one hidden on purpose after it was visible stays hidden. Returns the
// field to set when `record` is being made visible, or nothing if it already
// has one.
export const firstPublishedAt = (record: { publishedAt?: string }) =>
  record.publishedAt ? {} : { publishedAt: new Date().toISOString() };

// Content is added to ordinary lessons only: an assignment lesson (#102)
// holds exactly the one item it was created with.
export const requireOrdinaryLesson = (lesson: { kind?: string }) => {
  if (lesson.kind === 'assignment') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'An assignment holds only its own content. Add a lesson to the module to add more',
    });
  }
};

export const requireNotArchived = (
  record: { archivedAt?: string },
  message: string,
) => {
  if (record.archivedAt) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message });
  }
};

// An archived course is read-only: nothing in it can be added, edited,
// published, hidden, archived or restored until the course is restored. What
// stays possible is permanently deleting records that are already archived,
// so an archived course can be cleaned up without restoring it (which would
// show it to students again).
export const requireCourseNotArchived = (course: { status: string }) => {
  if (course.status === 'archived') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Restore the course first',
    });
  }
};

// Reads the course and refuses if it's archived, for writes that sit directly
// under it and have no module to read.
export const requireActiveCourse = async (
  coreTable: CoreTable,
  courseId: string,
) => {
  const course = await getCourseOrThrow(coreTable, courseId);
  requireCourseNotArchived(course);
  return course;
};

// An archived module or lesson freezes everything under it: nothing beneath
// it can be added, edited, published or hidden until it's restored, so a
// restore brings back exactly what was archived. Checks the course first (an
// archived course is read-only, see requireCourseNotArchived), then the
// module, and the lesson too when `lessonId` is given, matching the order
// restores have to happen in.
export const requireAncestorsNotArchived = async (
  coreTable: CoreTable,
  {
    courseId,
    moduleId,
    lessonId,
  }: { courseId: string; moduleId: string; lessonId?: string },
) => {
  const [{ data: course }, { data: module }, lessonResult] = await Promise.all([
    coreTable.entities.course.get({ courseId }).go(),
    coreTable.entities.module.get({ courseId, moduleId }).go(),
    lessonId === undefined
      ? Promise.resolve(undefined)
      : coreTable.entities.lesson.get({ courseId, moduleId, lessonId }).go(),
  ]);
  if (!course) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireCourseNotArchived(course);
  if (!module) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  requireNotArchived(module, 'Restore the module first');
  if (lessonResult !== undefined) {
    if (!lessonResult.data) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireNotArchived(lessonResult.data, 'Restore the lesson first');
  }
};

// Guards a permanent delete in a draft course. The draft/archive decision is
// made from a read of the course's status, which can go stale: if the course
// is published in between, the delete would destroy something in a course
// students can see. Added as the last item of the delete's transaction, so it
// lands only while the course is still a draft.
export const draftCourseCheck = (
  entities: TransactionEntities,
  courseId: string,
) =>
  entities.course
    .check({ courseId })
    .where((attr, op) => op.eq(attr.status, 'draft'))
    .commit();

export const courseNoLongerDraft = () =>
  new TRPCError({
    code: 'CONFLICT',
    message:
      'The course was published while this was being deleted; nothing was deleted. Retry to archive it instead',
  });
