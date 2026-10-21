/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { filterEffectivelyVisible } from '@discava/core-table';
import { courseProcedure } from '../init.js';
import {
  type IMyEnrolment,
  MyEnrolmentsInputSchema,
  MyEnrolmentsOutputSchema,
} from '../schema/index.js';

// Only what working out the next lesson and new items needs: not titles of
// items, nor their bodies, which can be large.
const VISIBILITY = ['visibility', 'archivedAt'] as const;

/**
 * The caller's courses, for the signed-in home and My Learning: each
 * enrolment that isn't dropped, with its course's title, the student's
 * progress, the lesson to continue with and how many items were added to
 * lessons they'd completed. Most recently active first.
 *
 * Per course this reads its outline (course, modules, lessons and the keys
 * and visibility of its items), and the student's item completions only for
 * a course with a completed lesson. Their lesson progress across every course
 * is one query.
 */
export const myEnrolments = courseProcedure
  .input(MyEnrolmentsInputSchema)
  .output(MyEnrolmentsOutputSchema)
  .query(async ({ ctx }) => {
    const coreTable = ctx.coreTable!;
    const userId = ctx.user.sub;

    const [{ data: enrolments }, { data: progress }] = await Promise.all([
      coreTable.entities.enrolment.query
        .byUser({ userId })
        .go({ pages: 'all' }),
      coreTable.entities.progress.query
        .primary({ userId })
        .go({ pages: 'all' }),
    ]);
    const completedLessonIds = new Set(
      progress
        .filter((lesson) => lesson.status === 'completed')
        .map((lesson) => lesson.lessonId),
    );

    const items = await Promise.all(
      enrolments
        .filter((enrolment) => enrolment.status !== 'dropped')
        .map(async (enrolment): Promise<IMyEnrolment | null> => {
          const { courseId } = enrolment;
          const [{ data: course }, modules, lessons, contentItems] =
            await Promise.all([
              coreTable.entities.course.get({ courseId }).go(),
              coreTable.entities.module.query
                .primary({ courseId })
                .go({
                  pages: 'all',
                  attributes: ['moduleId', 'title', 'order', ...VISIBILITY],
                })
                .then(({ data }) => data),
              coreTable.entities.lesson.query
                .primary({ courseId })
                .go({
                  pages: 'all',
                  attributes: [
                    'moduleId',
                    'lessonId',
                    'title',
                    'order',
                    ...VISIBILITY,
                  ],
                })
                .then(({ data }) => data),
              coreTable.entities.contentItem.query
                .primary({ courseId })
                .go({
                  pages: 'all',
                  attributes: [
                    'moduleId',
                    'lessonId',
                    'contentItemId',
                    ...VISIBILITY,
                  ],
                })
                .then(({ data }) => data),
            ]);
          // A course can't be deleted or unpublished with students in it,
          // but a list shouldn't fail on one that somehow was.
          if (!course || course.status === 'draft') {
            return null;
          }

          const visible = filterEffectivelyVisible({
            modules,
            lessons,
            contentItems,
          });
          const shownModules = visible.modules
            .slice()
            .sort((a, b) => a.order - b.order);
          // Lessons in course order: by module, then within it.
          const orderedLessons = shownModules.flatMap((module, moduleIndex) =>
            visible.lessons
              .filter((lesson) => lesson.moduleId === module.moduleId)
              .sort((a, b) => a.order - b.order)
              .map((lesson) => ({ lesson, module, moduleIndex })),
          );
          const next = orderedLessons.find(
            ({ lesson }) => !completedLessonIds.has(lesson.lessonId),
          );

          // New items: visible, not completed, in a lesson the student had
          // completed. Only worth a read once some lesson is completed.
          let newItemCount = 0;
          const completedHere = new Set(
            orderedLessons
              .map(({ lesson }) => lesson.lessonId)
              .filter((lessonId) => completedLessonIds.has(lessonId)),
          );
          if (completedHere.size > 0) {
            const { data: completions } =
              await coreTable.entities.itemCompletion.query
                .primary({ userId, courseId })
                .go({ pages: 'all', attributes: ['contentItemId'] });
            const done = new Set(completions.map((c) => c.contentItemId));
            newItemCount = visible.contentItems.filter(
              (item) =>
                completedHere.has(item.lessonId) &&
                !done.has(item.contentItemId),
            ).length;
          }

          return {
            courseId,
            title: course.title,
            ...(course.description && { description: course.description }),
            ...(course.imageKey && { imageKey: course.imageKey }),
            courseStatus: course.status,
            status: enrolment.status === 'completed' ? 'completed' : 'active',
            progressPercent: enrolment.progressPercent ?? 0,
            ...(enrolment.completedAt && {
              completedAt: enrolment.completedAt,
            }),
            ...(enrolment.lastActivityAt && {
              lastActivityAt: enrolment.lastActivityAt,
            }),
            enrolledAt: enrolment.createdAt,
            nextLesson: next
              ? {
                  lessonId: next.lesson.lessonId,
                  title: next.lesson.title,
                  moduleTitle: next.module.title,
                  moduleIndex: next.moduleIndex,
                }
              : null,
            newItemCount,
          };
        }),
    );

    const recency = (item: IMyEnrolment) =>
      item.lastActivityAt ?? item.enrolledAt;
    return {
      items: items
        .filter((item): item is IMyEnrolment => item !== null)
        .sort((a, b) => recency(b).localeCompare(recency(a))),
    };
  });
