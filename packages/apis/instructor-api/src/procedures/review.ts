/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { transactionConflict } from '@discava/common-server-utils/trpc-api-base';
import {
  type CoreTable,
  cancellationReasons,
  classifyReviewCancellation,
  hasTransactionConflict,
  type ReviewWrite,
  reviewerName,
  reviewWrites,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { requireCourseInstructor } from '../helpers/course-access.js';
import { courseInstructorProcedure, courseProcedure } from '../init.js';
import {
  DeleteReviewResponseInputSchema,
  DeleteReviewResponseOutputSchema,
  type IInstructorReview,
  ListReviewsInputSchema,
  ListReviewsOutputSchema,
  RespondToReviewInputSchema,
  RespondToReviewOutputSchema,
} from '../schema/index.js';

type StoredReview = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['review']['get']>['go']>
  >['data']
>;

const REMOVED_MESSAGE = 'This review was removed';

// Built key by key, so nothing else on the record (version, removal fields)
// can reach the caller.
const toInstructorReview = (review: StoredReview): IInstructorReview => ({
  reviewerId: review.userId,
  reviewerName: review.reviewerName,
  rating: review.rating,
  ...(review.text !== undefined && { text: review.text }),
  createdAt: review.createdAt,
  ...(review.editedAt !== undefined && { editedAt: review.editedAt }),
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

// The review an answer is about: it exists and is still visible.
const requireVisibleReview = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) => {
  const review = await getReview(coreTable, courseId, userId);
  if (!review) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  if (review.status === 'removed') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: REMOVED_MESSAGE,
    });
  }
  return review;
};

// Runs an answer's write, then reads the review back (transactions don't
// return the written attributes). A cancellation is the review having been
// removed or deleted, or the caller no longer teaching the course, since
// the check beforehand.
const writeResponse = async (
  coreTable: CoreTable,
  write: ReviewWrite,
): Promise<IInstructorReview> => {
  const { courseId, userId } = write;
  const { canceled, data } = await coreTable.transaction
    .write((entities) => reviewWrites(entities, write))
    .go();

  if (canceled) {
    const reasons = cancellationReasons(data);
    if (hasTransactionConflict(reasons)) {
      throw transactionConflict();
    }
    const cancellation = classifyReviewCancellation(write.action, reasons);
    if (cancellation === 'not-instructor') {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    if (cancellation === 'unavailable') {
      await requireVisibleReview(coreTable, courseId, userId);
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to save the response',
    });
  }

  const review = await getReview(coreTable, courseId, userId);
  if (!review) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The review was not found after it was written',
    });
  }
  return toInstructorReview(review);
};

// A course's visible reviews, newest first, for the instructors teaching it.
// Removed reviews stay in the index, so a page is filled by reading on until
// `limit` are kept or it ends.
export const listReviews = courseInstructorProcedure(ListReviewsInputSchema)
  .output(ListReviewsOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, limit } = input;

    const items: IInstructorReview[] = [];
    let cursor: string | null = input.cursor ?? null;
    do {
      const page = await coreTable.entities.review.query
        .byCourse({ courseId })
        .go({
          cursor: cursor ?? undefined,
          limit: limit - items.length,
          order: 'desc',
        });
      for (const stored of page.data) {
        if (stored.status === 'visible') {
          items.push(toInstructorReview(stored));
        }
      }
      cursor = page.cursor;
    } while (items.length < limit && cursor !== null);

    return { items, ...(cursor !== null && { cursor }) };
  });

// Sets or replaces the answer to a review. Any instructor of the course may
// replace another's. The review's rating, text and version are untouched.
export const respondToReview = courseProcedure
  .input(RespondToReviewInputSchema)
  .output(RespondToReviewOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, reviewerId, text } = input;
    const instructorId = ctx.user.sub;

    await requireCourseInstructor(coreTable, courseId, instructorId);
    await requireVisibleReview(coreTable, courseId, reviewerId);
    const { data: user } = await coreTable.entities.user
      .get({ userId: instructorId })
      .go();

    return writeResponse(coreTable, {
      action: 'respond',
      courseId,
      userId: reviewerId,
      at: new Date().toISOString(),
      instructorId,
      instructorName: reviewerName(user),
      text,
    });
  });

// Removes the answer; a review with none is returned as it is.
export const deleteReviewResponse = courseProcedure
  .input(DeleteReviewResponseInputSchema)
  .output(DeleteReviewResponseOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const { courseId, reviewerId } = input;
    const instructorId = ctx.user.sub;

    await requireCourseInstructor(coreTable, courseId, instructorId);
    const review = await requireVisibleReview(coreTable, courseId, reviewerId);
    if (review.responseText === undefined) {
      return toInstructorReview(review);
    }

    return writeResponse(coreTable, {
      action: 'deleteResponse',
      courseId,
      userId: reviewerId,
      at: new Date().toISOString(),
      instructorId,
    });
  });
