/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICoreTableContext } from '@discava/common-server-utils/trpc-middleware';
import {
  classifyReviewCancellation,
  ratingCount,
  reviewWrites,
  starCounts,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { adminProcedure } from '../init.js';
import {
  type IAdminReview,
  type IReviewCourse,
  ListAdminReviewsInputSchema,
  ListAdminReviewsOutputSchema,
  ListReviewCoursesInputSchema,
  ListReviewCoursesOutputSchema,
  RemoveReviewInputSchema,
  RemoveReviewOutputSchema,
} from '../schema/index.js';

type CoreTable = NonNullable<ICoreTableContext['coreTable']>;
type StoredReview = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['review']['get']>['go']>
  >['data']
>;

const COURSE_STATUSES = ['published', 'archived'] as const;
type CourseStatus = (typeof COURSE_STATUSES)[number];

// Built key by key, so nothing else on the record (version, ...) can reach
// the caller.
const toAdminReview = (review: StoredReview): IAdminReview => ({
  reviewerId: review.userId,
  reviewerName: review.reviewerName,
  rating: review.rating,
  ...(review.text !== undefined && { text: review.text }),
  createdAt: review.createdAt,
  ...(review.editedAt !== undefined && { editedAt: review.editedAt }),
  status: review.status,
  ...(review.removedAt !== undefined && { removedAt: review.removedAt }),
  ...(review.removedBy !== undefined && { removedBy: review.removedBy }),
  ...(review.removedReason !== undefined && {
    removedReason: review.removedReason,
  }),
  ...(review.responseText !== undefined && {
    response: {
      text: review.responseText,
      byName: review.responseByName ?? '',
      at: review.responseAt ?? '',
    },
  }),
});

const getReview = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) => (await coreTable.entities.review.get({ courseId, userId }).go()).data;

// Reviews exist for published and archived courses; a draft or unknown ID is
// not found.
const requireReviewableCourse = async (
  coreTable: CoreTable,
  courseId: string,
) => {
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  if (!course || !COURSE_STATUSES.includes(course.status as CourseStatus)) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
};

// The course picker's cursor is "<status>" or "<status>:<table cursor>": it
// says which of the two queries (published first, then archived) is being read.
const parseCourseCursor = (cursor?: string) => {
  if (cursor === undefined) {
    return { status: COURSE_STATUSES[0], after: undefined };
  }
  const [status, ...rest] = cursor.split(':');
  if (!COURSE_STATUSES.includes(status as CourseStatus)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid cursor' });
  }
  return {
    status: status as CourseStatus,
    after: rest.length > 0 ? rest.join(':') : undefined,
  };
};

// Published courses, then archived ones, newest first within each, with how
// many reviews each has (the tally's counts, one batch get).
export const listReviewCourses = adminProcedure
  .input(ListReviewCoursesInputSchema)
  .output(ListReviewCoursesOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { limit } = input;
    const start = parseCourseCursor(input.cursor);

    const courses: { courseId: string; title: string; status: CourseStatus }[] =
      [];
    let status: CourseStatus = start.status;
    let after = start.after;
    let next: string | undefined;
    while (courses.length < limit) {
      const page = await coreTable.entities.course.query
        .byStatus({ status })
        .go({ cursor: after, limit: limit - courses.length, order: 'desc' });
      for (const course of page.data) {
        courses.push({
          courseId: course.courseId,
          title: course.title,
          status,
        });
      }
      if (page.cursor !== null) {
        next = `${status}:${page.cursor}`;
        break;
      }
      const following = COURSE_STATUSES[COURSE_STATUSES.indexOf(status) + 1];
      if (following === undefined) {
        next = undefined;
        break;
      }
      status = following;
      after = undefined;
      next = following;
    }

    const ratings = new Map<string, number>();
    if (courses.length > 0) {
      const { data } = await coreTable.entities.courseRating
        .get(courses.map(({ courseId }) => ({ courseId })))
        .go();
      for (const record of data) {
        ratings.set(record.courseId, ratingCount(starCounts(record)));
      }
    }

    const items: IReviewCourse[] = courses.map((course) => ({
      ...course,
      ratingCount: ratings.get(course.courseId) ?? 0,
    }));
    // A page that ended exactly with the last query has nothing after it.
    return { items, ...(next !== undefined && { cursor: next }) };
  });

// A course's reviews, newest first, every status: removed ones stay in the
// index with their reason.
export const listAdminReviews = adminProcedure
  .input(ListAdminReviewsInputSchema)
  .output(ListAdminReviewsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, limit } = input;

    await requireReviewableCourse(coreTable, courseId);

    const page = await coreTable.entities.review.query
      .byCourse({ courseId })
      .go({ cursor: input.cursor, limit, order: 'desc' });

    return {
      items: page.data.map(toAdminReview),
      ...(page.cursor !== null && { cursor: page.cursor }),
    };
  });

// Marks a review removed and takes it out of the course's tally. Removing a
// removed review changes nothing. If the student edited it at the same
// moment, the write is cancelled; it is read again and tried once more, so
// the removal lands on the edited review.
export const removeReview = adminProcedure
  .input(RemoveReviewInputSchema)
  .output(RemoveReviewOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, reviewerId, reason } = input;

    await requireReviewableCourse(coreTable, courseId);

    let review = await getReview(coreTable, courseId, reviewerId);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!review) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (review.status === 'removed') {
        return toAdminReview(review);
      }

      const write = {
        action: 'remove',
        courseId,
        userId: reviewerId,
        at: new Date().toISOString(),
        existing: { version: review.version, rating: review.rating },
        removedBy: ctx.user.sub,
        reason,
      } as const;
      const { canceled, data } = await coreTable.transaction
        .write((entities) => reviewWrites(entities, write))
        .go();

      if (!canceled) {
        const removed = await getReview(coreTable, courseId, reviewerId);
        if (!removed) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'The review was not found after it was removed',
          });
        }
        return toAdminReview(removed);
      }

      const reasons: ({ code?: string } | undefined)[] = data ?? [];
      const conflict = reasons.some(
        (result) => result?.code === 'TransactionConflict',
      );
      if (
        !conflict &&
        classifyReviewCancellation('remove', reasons) !== 'stale'
      ) {
        break;
      }
      review = await getReview(coreTable, courseId, reviewerId);
    }

    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The review was changing at the same moment. Please retry',
    });
  });
