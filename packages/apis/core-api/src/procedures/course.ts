/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { filterEffectivelyVisible } from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure, publicCourseProcedure } from '../init.js';
import {
  type IViewCourseOutput,
  ListCoursesByInstructorInputSchema,
  ListCoursesByInstructorOutputSchema,
  ListInstructorsForCourseInputSchema,
  ListInstructorsForCourseOutputSchema,
  PublicListCoursesInputSchema,
  PublicListCoursesOutputSchema,
  PublicViewCourseOutputSchema,
  ViewCourseInputSchema,
  ViewCourseOutputSchema,
} from '../schema/index.js';
import { getEnrolment, requireEnrolment } from './enrolment.js';

export const listCoursesByInstructor = courseProcedure
  .input(ListCoursesByInstructorInputSchema)
  .output(ListCoursesByInstructorOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { instructorId, cursor, limit } = input;

    // byInstructor's sort key is courseUpdatedAt#courseId; order: 'desc'
    // surfaces the most recently updated courses first.
    const { data: memberships, cursor: nextCursor } =
      await coreTable.entities.courseInstructor.query
        .byInstructor({ instructorId })
        .go({ cursor, limit, order: 'desc' });
    if (memberships.length === 0) {
      return { items: [], cursor: nextCursor };
    }

    // preserveBatchOrder so a course deleted after its membership row was
    // written shows up as a null gap to filter out, not a silently
    // reordered/shortened page.
    const { data: courses } = await coreTable.entities.course
      .get(memberships.map(({ courseId }) => ({ courseId })))
      .go({ preserveBatchOrder: true });

    return {
      items: courses.filter((course) => course !== null),
      cursor: nextCursor,
    };
  });

export const listInstructorsForCourse = courseProcedure
  .input(ListInstructorsForCourseInputSchema)
  .output(ListInstructorsForCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, cursor, limit } = input;

    const { data: memberships, cursor: nextCursor } =
      await coreTable.entities.courseInstructor.query
        .primary({ courseId })
        .go({ cursor, limit });
    if (memberships.length === 0) {
      return { items: [], cursor: nextCursor };
    }

    const { data: instructors } = await coreTable.entities.user
      .get(memberships.map(({ instructorId }) => ({ userId: instructorId })))
      .go({ preserveBatchOrder: true });

    return {
      items: instructors.filter((instructor) => instructor !== null),
      cursor: nextCursor,
    };
  });

export const publicListCourses = publicCourseProcedure
  .input(PublicListCoursesInputSchema)
  .output(PublicListCoursesOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { cursor, limit } = input;

    const { data: courses, cursor: nextCursor } =
      await coreTable.entities.course.query
        .byStatus({ status: 'published' })
        .go({ cursor, limit });

    return { items: courses, cursor: nextCursor };
  });

// Anonymous course preview for the public landing page's "Learn more" link.
// Unlike viewCourse, this never returns content items (previewing a course's
// shape shouldn't expose its actual lesson content) and only ever resolves
// published courses - draft/archived courses 404 the same as a courseId that
// doesn't exist, so their existence isn't leaked to anonymous callers.
export const publicViewCourse = publicCourseProcedure
  .input(ViewCourseInputSchema)
  .output(PublicViewCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;

    // Every page: a course's curriculum can exceed a single 1 MB query page.
    const { data } = await coreTable.collections
      .curriculum({ courseId: input.courseId })
      .go({ pages: 'all' });
    const [course] = data.course;
    if (!course || course.status !== 'published') {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    // Only what a student may see, so a hidden or archived module or lesson
    // isn't leaked to anonymous callers either.
    const { modules, lessons } = filterEffectivelyVisible({
      modules: data.module,
      lessons: data.lesson,
      contentItems: [],
    });

    const lessonsByModuleId = new Map<string, typeof lessons>();
    for (const lesson of lessons) {
      const moduleLessons = lessonsByModuleId.get(lesson.moduleId) ?? [];
      moduleLessons.push(lesson);
      lessonsByModuleId.set(lesson.moduleId, moduleLessons);
    }

    return {
      ...course,
      modules: modules
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((module) => ({
          ...module,
          lessons: (lessonsByModuleId.get(module.moduleId) ?? [])
            .slice()
            .sort((a, b) => a.order - b.order),
        })),
    };
  });

export const viewCourse = courseProcedure
  .input(ViewCourseInputSchema)
  .output(ViewCourseOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;

    // Course, its modules, their lessons, and each lesson's content items
    // all share the `curriculum` collection's partition (see
    // @discava/core-table's service.ts), so one query returns the whole
    // curriculum instead of a get plus per-module/per-lesson queries.
    // Every page: a course's curriculum can exceed a single 1 MB query page.
    const [{ data }, enrolment] = await Promise.all([
      coreTable.collections
        .curriculum({ courseId: input.courseId })
        .go({ pages: 'all' }),
      getEnrolment(coreTable, input.courseId, ctx.user.sub),
    ]);
    const [course] = data.course;
    if (!course) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    requireEnrolment(course, enrolment);
    // Students only see a module, lesson or content item that is visible, not
    // archived, and not under a hidden or archived ancestor. Instructors edit
    // the full curriculum through instructor-api's course.view instead.
    const { modules, lessons, contentItems } = filterEffectivelyVisible({
      modules: data.module,
      lessons: data.lesson,
      contentItems: data.contentItem,
    });

    const contentItemsByLessonId = new Map<string, typeof contentItems>();
    for (const contentItem of contentItems) {
      const lessonContentItems =
        contentItemsByLessonId.get(contentItem.lessonId) ?? [];
      lessonContentItems.push(contentItem);
      contentItemsByLessonId.set(contentItem.lessonId, lessonContentItems);
    }

    const lessonsByModuleId = new Map<string, typeof lessons>();
    for (const lesson of lessons) {
      const moduleLessons = lessonsByModuleId.get(lesson.moduleId) ?? [];
      moduleLessons.push(lesson);
      lessonsByModuleId.set(lesson.moduleId, moduleLessons);
    }

    // contentItem's ElectroDB-inferred type is flat (`type: 'video' | 'text'`
    // alongside every other attribute as optional), not a proper union keyed
    // on `type` -- ElectroDB has no native discriminated-attribute support.
    // The cast bridges that gap to the discriminated-union output type; the
    // zod output schema is what actually validates the shape at runtime.
    return {
      ...course,
      modules: modules
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((module) => ({
          ...module,
          lessons: (lessonsByModuleId.get(module.moduleId) ?? [])
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((lesson) => ({
              ...lesson,
              contentItems: (contentItemsByLessonId.get(lesson.lessonId) ?? [])
                .slice()
                .sort((a, b) => a.order - b.order),
            })),
        })),
    } as IViewCourseOutput;
  });
