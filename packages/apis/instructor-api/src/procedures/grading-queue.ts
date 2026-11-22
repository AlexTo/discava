/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defaultDisplayName } from '@discava/core-table';
import { courseProcedure } from '../init.js';
import {
  GradingQueueInputSchema,
  GradingQueueOutputSchema,
  type IGradingQueueItem,
  type IGradingQueueOutput,
} from '../schema/index.js';

// The work waiting for the caller across all their courses, oldest first
// (specs/20261120-230057-assignment-grading/contracts/
// instructor-api-assignment-submission.md). Every waiting entry is read, so
// `total` is exact; the cost follows the waiting work, not the course sizes.
// Enrolment is applied here, at read time: the waiting index doesn't know
// when a student drops.
export const listGradingQueue = courseProcedure
  .input(GradingQueueInputSchema)
  .output(GradingQueueOutputSchema)
  .query(async ({ ctx, input }): Promise<IGradingQueueOutput> => {
    const coreTable = ctx.coreTable;
    const { data: memberships } =
      await coreTable.entities.courseInstructor.query
        .byInstructor({ instructorId: ctx.user.sub })
        .go({ pages: 'all' });
    const courseIds = [...new Set(memberships.map(({ courseId }) => courseId))];
    if (courseIds.length === 0) {
      return { total: 0, items: [] };
    }

    const waiting = (
      await Promise.all(
        courseIds.map(async (waitingCourseId) => {
          const { data } = await coreTable.entities.assignmentSubmission.query
            .byWaiting({ waitingCourseId })
            .go({ pages: 'all' });
          return data;
        }),
      )
    ).flat();
    if (waiting.length === 0) {
      return { total: 0, items: [] };
    }

    const { data: enrolments } = await coreTable.entities.enrolment
      .get(waiting.map(({ courseId, userId }) => ({ courseId, userId })))
      .go();
    const left = new Set(
      enrolments
        .filter(({ status }) => status === 'dropped')
        .map(({ courseId, userId }) => `${courseId}#${userId}`),
    );
    const enrolled = new Set(
      enrolments.map(({ courseId, userId }) => `${courseId}#${userId}`),
    );
    const queue = waiting
      .filter((entry) => {
        const key = `${entry.courseId}#${entry.userId}`;
        return enrolled.has(key) && !left.has(key);
      })
      .sort(
        (a, b) =>
          (a.waitingSince ?? a.submittedAt).localeCompare(
            b.waitingSince ?? b.submittedAt,
          ) ||
          a.contentItemId.localeCompare(b.contentItemId) ||
          a.userId.localeCompare(b.userId),
      );
    const page = queue.slice(0, input.limit);
    if (page.length === 0) {
      return { total: queue.length, items: [] };
    }

    const pageCourseIds = [...new Set(page.map(({ courseId }) => courseId))];
    const [{ data: courses }, { data: users }, { data: items }] =
      await Promise.all([
        coreTable.entities.course
          .get(pageCourseIds.map((courseId) => ({ courseId })))
          .go(),
        coreTable.entities.user
          .get(
            [...new Set(page.map(({ userId }) => userId))].map((userId) => ({
              userId,
            })),
          )
          .go(),
        Promise.all(
          pageCourseIds.map(
            async (courseId) =>
              (
                await coreTable.entities.contentItem.query
                  .primary({ courseId })
                  .go({ pages: 'all' })
              ).data,
          ),
        ).then((perCourse) => ({ data: perCourse.flat() })),
      ]);
    const courseTitles = new Map(courses.map((c) => [c.courseId, c.title]));
    const names = new Map(users.map((u) => [u.userId, defaultDisplayName(u)]));
    const assignments = new Map(
      items
        .filter((item) => item.type === 'assignment')
        .map((item) => [`${item.courseId}#${item.contentItemId}`, item]),
    );
    const { data: lessons } = await coreTable.entities.lesson
      .get(
        [...assignments.values()].map(({ courseId, moduleId, lessonId }) => ({
          courseId,
          moduleId,
          lessonId,
        })),
      )
      .go();
    const lessonTitles = new Map(
      lessons.map((l) => [`${l.courseId}#${l.lessonId}`, l.title]),
    );

    return {
      total: queue.length,
      items: page.map((entry): IGradingQueueItem => {
        const item = assignments.get(
          `${entry.courseId}#${entry.contentItemId}`,
        );
        return {
          courseId: entry.courseId,
          courseTitle: courseTitles.get(entry.courseId) ?? '',
          contentItemId: entry.contentItemId,
          assignmentTitle: item
            ? (lessonTitles.get(`${item.courseId}#${item.lessonId}`) ?? '')
            : '',
          userId: entry.userId,
          displayName: names.get(entry.userId) ?? defaultDisplayName(),
          submittedAt: entry.submittedAt,
          late: entry.late,
        };
      }),
    };
  });
