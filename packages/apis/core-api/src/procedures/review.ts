/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  classifyReviewCancellation,
  type createCoreTableService,
  type ReviewWrite,
  reviewerName,
  reviewWrites,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure, publicCourseProcedure } from '../init.js';
import { ratingFigures } from '../lib/rating.js';
import {
  type CancellationReasons,
  hasTransactionConflict,
  transactionConflict,
} from '../lib/transaction.js';
import {
  DeleteReviewInputSchema,
  DeleteReviewOutputSchema,
  EditReviewInputSchema,
  type IOwnReview,
  type IPublicReview,
  MyReviewInputSchema,
  MyReviewOutputSchema,
  OwnReviewSchema,
  PostReviewInputSchema,
  ReviewListInputSchema,
  ReviewListOutputSchema,
  ReviewSummaryInputSchema,
  ReviewSummaryOutputSchema,
} from '../schema/index.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type StoredReview = NonNullable<
  Awaited<
    ReturnType<ReturnType<CoreTable['entities']['review']['get']>['go']>
  >['data']
>;

const REMOVED_MESSAGE = 'This review was removed';
const STALE_MESSAGE = 'Your review changed; reload it';

const responseOf = (review: StoredReview) =>
  review.responseText === undefined
    ? undefined
    : {
        text: review.responseText,
        byName: review.responseByName ?? '',
        at: review.responseAt ?? '',
      };

// A review as its author sees it. Built key by key, so nothing else on the
// record (the userId, who removed it) can reach the caller.
const toOwnReview = (review: StoredReview): IOwnReview => ({
  rating: review.rating,
  text: review.text,
  createdAt: review.createdAt,
  editedAt: review.editedAt,
  version: review.version,
  status: review.status,
  removedReason: review.status === 'removed' ? review.removedReason : undefined,
  response: responseOf(review),
});

// A review as anyone sees it: no userId, version, status or removal field.
const toPublicReview = (review: StoredReview): IPublicReview => ({
  reviewerName: review.reviewerName,
  rating: review.rating,
  text: review.text,
  createdAt: review.createdAt,
  editedAt: review.editedAt,
  response: responseOf(review),
});

const getReview = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) => (await coreTable.entities.review.get({ courseId, userId }).go()).data;

// The review an edit or delete is about: the caller's own, still visible.
const requireOwnVisibleReview = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) => {
  const review = await getReview(coreTable, courseId, userId);
  if (!review) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }
  if (review.status === 'removed') {
    throw new TRPCError({ code: 'FORBIDDEN', message: REMOVED_MESSAGE });
  }
  return review;
};

// Runs the write; on a cancellation, works out why and throws. `reread` runs
// once a condition failed, to say what changed.
const commit = async (
  coreTable: CoreTable,
  write: ReviewWrite,
  onCancelled: (
    cancellation: ReturnType<typeof classifyReviewCancellation>,
  ) => Promise<never>,
) => {
  const { canceled, data } = await coreTable.transaction
    .write((entities) => reviewWrites(entities, write))
    .go();
  if (!canceled) {
    return;
  }
  const reasons: CancellationReasons = data ?? [];
  if (hasTransactionConflict(reasons)) {
    throw transactionConflict();
  }
  return onCancelled(classifyReviewCancellation(write.action, reasons));
};

// An edit or delete whose conditions failed: the review changed since it was
// read, or was removed or deleted meanwhile.
const staleReview = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
  cancellation: ReturnType<typeof classifyReviewCancellation>,
): Promise<never> => {
  if (cancellation === undefined) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to change the review',
    });
  }
  await requireOwnVisibleReview(coreTable, courseId, userId);
  throw new TRPCError({ code: 'CONFLICT', message: STALE_MESSAGE });
};

const requireWritten = async (
  coreTable: CoreTable,
  courseId: string,
  userId: string,
) => {
  // Transactions don't return the written attributes.
  const review = await getReview(coreTable, courseId, userId);
  if (!review) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The review was not found after it was written',
    });
  }
  return toOwnReview(review);
};

// The caller's review of a course, or null. A removed one comes back with its
// status and reason so the portal can show the notice and hide the form.
export const myReview = courseProcedure
  .input(MyReviewInputSchema)
  .output(MyReviewOutputSchema)
  .query(async ({ ctx, input }) => {
    const review = await getReview(
      ctx.coreTable!,
      input.courseId,
      ctx.user.sub,
    );
    return review ? toOwnReview(review) : null;
  });

// Posts the caller's review. Enrolment, the course's status and the one review
// per student are all checked in the transaction that writes it.
export const postReview = courseProcedure
  .input(PostReviewInputSchema)
  .output(OwnReviewSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, rating, text } = input;
    const userId = ctx.user.sub;

    const { data: user } = await coreTable.entities.user.get({ userId }).go();

    await commit(
      coreTable,
      {
        action: 'post',
        courseId,
        userId,
        at: new Date().toISOString(),
        reviewerName: reviewerName(user),
        rating,
        text,
      },
      async (cancellation) => {
        if (cancellation === 'already-reviewed') {
          const existing = await getReview(coreTable, courseId, userId);
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              existing?.status === 'removed'
                ? 'Your review of this course was removed'
                : 'You already reviewed this course',
          });
        }
        if (cancellation === 'not-enrolled') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Enrol in the course to review it',
          });
        }
        if (cancellation === 'course-closed') {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This course is not open for new reviews',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to post the review',
        });
      },
    );

    return requireWritten(coreTable, courseId, userId);
  });

// Changes the caller's review, whatever the course's or enrolment's status.
export const editReview = courseProcedure
  .input(EditReviewInputSchema)
  .output(OwnReviewSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, rating, text, version } = input;
    const userId = ctx.user.sub;

    const review = await requireOwnVisibleReview(coreTable, courseId, userId);
    if (review.version !== version) {
      throw new TRPCError({ code: 'CONFLICT', message: STALE_MESSAGE });
    }

    await commit(
      coreTable,
      {
        action: 'edit',
        courseId,
        userId,
        at: new Date().toISOString(),
        rating,
        text,
        existing: { version, rating: review.rating },
      },
      (cancellation) => staleReview(coreTable, courseId, userId, cancellation),
    );

    return requireWritten(coreTable, courseId, userId);
  });

export const deleteReview = courseProcedure
  .input(DeleteReviewInputSchema)
  .output(DeleteReviewOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable!;
    const { courseId, version } = input;
    const userId = ctx.user.sub;

    const review = await requireOwnVisibleReview(coreTable, courseId, userId);
    if (review.version !== version) {
      throw new TRPCError({ code: 'CONFLICT', message: STALE_MESSAGE });
    }

    await commit(
      coreTable,
      {
        action: 'delete',
        courseId,
        userId,
        at: new Date().toISOString(),
        existing: { version, rating: review.rating },
      },
      (cancellation) => staleReview(coreTable, courseId, userId, cancellation),
    );

    return { deleted: true as const };
  });

// A course's rating summary: one keyed get of its tally.
export const reviewSummary = publicCourseProcedure
  .input(ReviewSummaryInputSchema)
  .output(ReviewSummaryOutputSchema)
  .query(async ({ ctx, input }) => {
    const { data } = await ctx
      .coreTable!.entities.courseRating.get({ courseId: input.courseId })
      .go();
    const { count, average, stars } = ratingFigures(data);
    return {
      count,
      average,
      stars: {
        1: stars[0],
        2: stars[1],
        3: stars[2],
        4: stars[3],
        5: stars[4],
      },
    };
  });

// A course's visible reviews, newest first. Removed reviews stay in the index,
// so a page is filled by reading on until `limit` are kept or it ends.
export const listReviews = publicCourseProcedure
  .input(ReviewListInputSchema)
  .output(ReviewListOutputSchema)
  .query(async ({ ctx, input }) => {
    const { review } = ctx.coreTable!.entities;
    const { courseId, limit } = input;

    const items: IPublicReview[] = [];
    let cursor: string | null = input.cursor ?? null;
    do {
      const page = await review.query.byCourse({ courseId }).go({
        cursor: cursor ?? undefined,
        limit: limit - items.length,
        order: 'desc',
      });
      for (const stored of page.data) {
        if (stored.status === 'visible') {
          items.push(toPublicReview(stored));
        }
      }
      cursor = page.cursor;
    } while (items.length < limit && cursor !== null);

    return { items, cursor };
  });
