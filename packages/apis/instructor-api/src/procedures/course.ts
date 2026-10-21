/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  filterEffectivelyVisible,
  isConditionalCheckFailed,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { v7 as uuidv7 } from 'uuid';
import { courseProcedure } from '../init.js';
import {
  getCourseOrThrow,
  hasTransactionConflict,
  refreshInstructorCourseUpdatedAt,
  requireCourseInstructor,
  transactionConflict,
} from '../lib/course-lifecycle.js';
import {
  ArchiveCourseInputSchema,
  ArchiveCourseOutputSchema,
  CreateCourseInputSchema,
  CreateCourseOutputSchema,
  type IViewCourseOutput,
  PublishCourseInputSchema,
  PublishCourseOutputSchema,
  RestoreCourseInputSchema,
  RestoreCourseOutputSchema,
  ViewCourseInputSchema,
  ViewCourseOutputSchema,
} from '../schema/index.js';

export const createCourse = courseProcedure
  .input(CreateCourseInputSchema)
  .output(CreateCourseOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const courseId = uuidv7();
    const { sub: currentUser } = ctx.user;
    const { title, description } = input;
    // Course.updatedAt is computed by ElectroDB at write time (not settable
    // here), so this is only an approximation of its real value - fine for a
    // brand new course that's never been touched since.
    const courseUpdatedAt = new Date().toISOString();

    // A course must always have at least one instructor, so the course and
    // its initial CourseInstructor row are written transactionally: either
    // both succeed or neither does. DynamoDB transactions don't return the
    // written attributes, so fetch the course back once the write commits.
    const { canceled } = await coreTable.transaction
      .write((entities) => [
        entities.course.create({ courseId, title, description }).commit(),
        entities.courseInstructor
          .create({ courseId, instructorId: currentUser, courseUpdatedAt })
          .commit(),
      ])
      .go();

    if (canceled) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create course',
      });
    }

    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create course',
      });
    }

    return course;
  });

export const archiveCourse = courseProcedure
  .input(ArchiveCourseInputSchema)
  .output(ArchiveCourseOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;
    const { sub: currentUser } = ctx.user;

    // Only instructors teaching this specific course may archive it, not
    // just any member of the instructor group.
    const { data: membership } = await coreTable.entities.courseInstructor
      .get({ courseId, instructorId: currentUser })
      .go();
    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    const { data: course } = await coreTable.entities.course
      .patch({ courseId })
      .set({ status: 'archived' })
      .go({ response: 'all_new' });

    await refreshInstructorCourseUpdatedAt(
      coreTable,
      courseId,
      course.updatedAt,
    );

    return course;
  });

const courseChanged = () =>
  new TRPCError({
    code: 'CONFLICT',
    message: 'The course was modified by another request; please retry',
  });

// A draft course becomes visible to students: published. Only a draft can
// be published, and only once it has content, so a course isn't opened up
// empty. Repeating it on a published course writes nothing.
export const publishCourse = courseProcedure
  .input(PublishCourseInputSchema)
  .output(PublishCourseOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    const course = await getCourseOrThrow(coreTable, courseId);
    if (course.status === 'published') {
      return course;
    }
    if (course.status === 'archived') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Restore the course before publishing it',
      });
    }

    // Only content students will see counts: a draft course's records can be
    // hidden or archived too, and publishing the course doesn't change them.
    // Every page: a curriculum can exceed a single 1 MB query page.
    const {
      data: { module: modules, lesson: lessons, contentItem: contentItems },
    } = await coreTable.collections
      .curriculum({ courseId })
      .go({ pages: 'all' });
    const visible = filterEffectivelyVisible({
      modules,
      lessons,
      contentItems,
    });
    if (visible.contentItems.length === 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Add at least one visible content item before publishing the course',
      });
    }

    // The count above can go stale before the write: a draft course's
    // content can be permanently deleted, hidden or archived in between. So
    // the same transaction that publishes the course also checks that one of
    // the visible content items, and the lesson and module it sits under, is
    // still there and still visible. If it isn't, nothing is published.
    const [witness] = visible.contentItems;
    const { moduleId, lessonId, contentItemId } = witness;
    const { canceled, data: results } = await coreTable.transaction
      .write((entities) => [
        entities.course
          .patch({ courseId })
          .set({ status: 'published', publishedAt: new Date().toISOString() })
          .where((attr, op) => op.eq(attr.status, 'draft'))
          .commit(),
        entities.module
          .check({ courseId, moduleId })
          .where(
            (attr, op) =>
              `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
          )
          .commit(),
        entities.lesson
          .check({ courseId, moduleId, lessonId })
          .where(
            (attr, op) =>
              `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
          )
          .commit(),
        entities.contentItem
          .check({ courseId, moduleId, lessonId, contentItemId })
          .where(
            (attr, op) =>
              `${op.eq(attr.visibility, 'visible')} AND ${op.notExists(attr.archivedAt)}`,
          )
          .commit(),
      ])
      .go();

    if (canceled) {
      const failed = (results ?? []).map(
        (result: { code?: string } | undefined) =>
          result?.code === 'ConditionalCheckFailed',
      );
      if (failed[0]) {
        // Another request moved the course on between the read and the write.
        const current = await getCourseOrThrow(coreTable, courseId);
        if (current.status === 'published') {
          return current;
        }
        throw courseChanged();
      }
      if (failed.slice(1).some(Boolean)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            "The course's content changed while publishing; please retry",
        });
      }
      if (hasTransactionConflict(results)) {
        throw transactionConflict();
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to publish the course',
      });
    }

    // Transactions don't return the written attributes.
    const published = await getCourseOrThrow(coreTable, courseId);
    await refreshInstructorCourseUpdatedAt(
      coreTable,
      courseId,
      published.updatedAt,
    );
    return published;
  });

// Brings an archived course back: to published if it has ever been
// published, otherwise to draft. A course that has been open to students
// never returns to draft, where deletes are permanent. Repeating it on a
// course that isn't archived writes nothing.
export const restoreCourse = courseProcedure
  .input(RestoreCourseInputSchema)
  .output(RestoreCourseOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    const course = await getCourseOrThrow(coreTable, courseId);
    if (course.status !== 'archived') {
      return course;
    }

    try {
      const { data: restored } = await coreTable.entities.course
        .patch({ courseId })
        .set({ status: course.publishedAt ? 'published' : 'draft' })
        .where((attr, op) => op.eq(attr.status, 'archived'))
        .go({ response: 'all_new' });
      await refreshInstructorCourseUpdatedAt(
        coreTable,
        courseId,
        restored.updatedAt,
      );
      return restored;
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const current = await getCourseOrThrow(coreTable, courseId);
      if (current.status !== 'archived') {
        return current;
      }
      throw courseChanged();
    }
  });

// The course editor's view: the whole curriculum, including hidden and
// archived modules, lessons and content items, for instructors teaching the
// course. Students read the course through core-api's course.view, which
// only returns what they may see.
export const viewCourse = courseProcedure
  .input(ViewCourseInputSchema)
  .output(ViewCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId } = input;

    await requireCourseInstructor(coreTable, courseId, ctx.user.sub);

    // Course, its modules, their lessons, and each lesson's content items
    // all share the `curriculum` collection's partition, so one query
    // returns the whole curriculum -- every page of it, since a course's
    // curriculum can exceed a single 1 MB query page.
    const {
      data: {
        course: courses,
        module: modules,
        lesson: lessons,
        contentItem: contentItems,
      },
    } = await coreTable.collections
      .curriculum({ courseId })
      .go({ pages: 'all' });
    const [course] = courses;
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const byOrder = (a: { order: number }, b: { order: number }) =>
      a.order - b.order;

    // contentItem's ElectroDB-inferred type is flat rather than a union
    // keyed on `type`; the cast bridges that gap to the discriminated-union
    // output type, and the zod output schema validates the shape at runtime.
    return {
      ...course,
      modules: modules
        .slice()
        .sort(byOrder)
        .map((module) => ({
          ...module,
          lessons: lessons
            .filter((lesson) => lesson.moduleId === module.moduleId)
            .sort(byOrder)
            .map((lesson) => ({
              ...lesson,
              contentItems: contentItems
                .filter((item) => item.lessonId === lesson.lessonId)
                .sort(byOrder),
            })),
        })),
    } as IViewCourseOutput;
  });
