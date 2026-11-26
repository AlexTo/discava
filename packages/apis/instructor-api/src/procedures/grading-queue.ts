/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type CoreTable, defaultDisplayName } from '@discava/core-table';
import { courseProcedure } from '../init.js';
import {
  GradingQueueInputSchema,
  GradingQueueOutputSchema,
  type IGradingQueueItem,
  type IGradingQueueOutput,
} from '../schema/index.js';

// The first of each run of entries with the same key, for a batch get, which
// DynamoDB refuses when its keys repeat.
const uniqueKeys = <T>(entries: T[], key: (entry: T) => string): T[] => [
  ...new Map(entries.map((entry) => [key(entry), entry] as const)).values(),
];

const READ_ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;

// Reads the enrolments for `keys`, asking again, after a growing pause, for
// the keys DynamoDB left unprocessed under throttling. A student whose
// enrolment is missing counts as having left, so a short read must fail the
// request rather than shorten the queue.
const readEnrolments = async (
  coreTable: CoreTable,
  keys: { courseId: string; userId: string }[],
) => {
  const enrolments = [];
  let pending = keys;
  for (let attempt = 0; pending.length > 0; attempt++) {
    if (attempt === READ_ATTEMPTS) {
      throw new Error('Enrolments could not be read: throttled');
    }
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS * 2 ** (attempt - 1)),
      );
    }
    const { data, unprocessed } = await coreTable.entities.enrolment
      .get(pending)
      .go();
    enrolments.push(...data);
    pending = unprocessed;
  }
  return enrolments;
};

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

    // One key per student and course: a student can have several waiting
    // submissions in a course, and a batch get refuses duplicate keys.
    const enrolments = await readEnrolments(
      coreTable,
      uniqueKeys(
        waiting,
        ({ courseId, userId }) => `${courseId}#${userId}`,
      ).map(({ courseId, userId }) => ({ courseId, userId })),
    );
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
        uniqueKeys(
          [...assignments.values()],
          ({ courseId, lessonId }) => `${courseId}#${lessonId}`,
        ).map(({ courseId, moduleId, lessonId }) => ({
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
