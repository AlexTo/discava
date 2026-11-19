/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { useCoreApi } from '../../../../api';
import { RatingSummary } from '../../../../components/rating-summary';
import { formatReviewDate } from './review-date';
import { ReviewForm } from './review-form';

const PAGE_SIZE = 10;
const STAR_ROWS = [5, 4, 3, 2, 1] as const;

function Breakdown({ stars }: { stars: Record<1 | 2 | 3 | 4 | 5, number> }) {
  const largest = Math.max(...STAR_ROWS.map((n) => stars[n]), 1);
  return (
    <ul className="w-full max-w-sm space-y-1.5" aria-label="Ratings breakdown">
      {STAR_ROWS.map((n) => (
        <li key={n} className="flex items-center gap-3 text-sm">
          <span className="w-14 shrink-0">
            {n} {n === 1 ? 'star' : 'stars'}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-amber-400"
              style={{ width: `${(stars[n] / largest) * 100}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-muted-foreground">
            {stars[n]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReviewSummary({ courseId }: { courseId: string }) {
  const trpc = useCoreApi();
  const summaryQuery = useQuery(trpc.review.summary.queryOptions({ courseId }));

  if (summaryQuery.isPending) {
    return <Skeleton className="h-24 w-full max-w-sm" />;
  }
  if (summaryQuery.isError) {
    return (
      <ErrorAlert type="error" header="Couldn't load the ratings">
        {apiErrorMessage(summaryQuery.error)}
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => summaryQuery.refetch()}
        >
          Retry
        </Button>
      </ErrorAlert>
    );
  }
  const { average, count, stars } = summaryQuery.data;
  return (
    <div className="space-y-3">
      <RatingSummary average={average} count={count} />
      {count > 0 ? <Breakdown stars={stars} /> : null}
    </div>
  );
}

function ReviewList({ courseId }: { courseId: string }) {
  const trpc = useCoreApi();
  const { isAuthenticated } = useAuth();
  // Shares the cache with the enrolment action; only a signed-in student has one.
  const enrolmentQuery = useQuery(
    trpc.course.myEnrolment.queryOptions(
      { courseId },
      { enabled: isAuthenticated },
    ),
  );
  const enrolled =
    !!enrolmentQuery.data && enrolmentQuery.data.status !== 'dropped';

  const listQuery = useInfiniteQuery(
    trpc.review.list.infiniteQueryOptions(
      { courseId, limit: PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.cursor ?? undefined },
    ),
  );

  if (listQuery.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading reviews">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (listQuery.isError) {
    return (
      <ErrorAlert type="error" header="Couldn't load the reviews">
        {apiErrorMessage(listQuery.error)}
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => listQuery.refetch()}
        >
          Retry
        </Button>
      </ErrorAlert>
    );
  }

  const reviews = listQuery.data.pages.flatMap((page) => page.items);
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {enrolled ? 'Be the first to review this course' : 'No reviews yet'}
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y">
        {reviews.map((review, index) => (
          // The public review carries no id, and the list is newest first.
          <li key={index} className="space-y-2 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{review.reviewerName}</span>
              <span className="inline-flex items-center gap-1 text-sm">
                <Star
                  className="size-4 fill-amber-400 text-amber-400"
                  aria-hidden="true"
                />
                {review.rating} {review.rating === 1 ? 'star' : 'stars'}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatReviewDate(review.createdAt)}
                {review.editedAt ? ' · edited' : ''}
              </span>
            </div>
            {review.text ? (
              <p className="whitespace-pre-line break-words text-sm">
                {review.text}
              </p>
            ) : null}
            {review.response ? (
              <div className="ml-4 border-l-2 pl-4 text-sm">
                <p className="font-medium">
                  Response from {review.response.byName}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-muted-foreground">
                  {review.response.text}
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {listQuery.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={listQuery.isFetchingNextPage}
            onClick={() => listQuery.fetchNextPage()}
          >
            {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

// The course page's Reviews section: the rating summary and breakdown, the
// student's own review form, and the reviews newest first. Signed-out visitors
// see the summary and list too: both are public calls.
export function CourseReviews({ courseId }: { courseId: string }) {
  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="scroll-mt-32 space-y-6"
    >
      <h2 id="reviews-heading" className="text-xl font-semibold">
        Reviews
      </h2>
      <ReviewSummary courseId={courseId} />
      <ReviewForm courseId={courseId} />
      <ReviewList courseId={courseId} />
    </section>
  );
}
