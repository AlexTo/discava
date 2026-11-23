/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCoreApi, useInstructorApi } from '../../../../../api';
import {
  DeleteResponseDialog,
  respondButtonId,
} from './delete-response-dialog';
import { ResponseDialog } from './response-dialog';

const STARS = [5, 4, 3, 2, 1] as const;

const date = (iso: string) => new Date(iso).toLocaleDateString();

function Summary({
  isPending,
  data,
}: {
  isPending: boolean;
  data?: {
    count: number;
    average?: number;
    stars: Record<number, number>;
  };
}) {
  if (isPending) {
    return <LoadingState label="Loading ratings…" />;
  }
  if (!data) {
    return null;
  }
  const { count, average, stars } = data;
  if (count === 0 || average === undefined) {
    return <p className="text-sm text-muted-foreground">No ratings yet.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div>
        <p className="text-4xl font-bold">{average.toFixed(1)}</p>
        <p className="text-sm text-muted-foreground">
          {count === 1 ? '1 rating' : `${count} ratings`}
        </p>
      </div>
      <ul aria-label="Ratings breakdown" className="min-w-48 space-y-1">
        {STARS.map((star) => (
          <li key={star} className="flex items-center gap-2 text-sm">
            <span className="w-14">{`${star} ${star === 1 ? 'star' : 'stars'}`}</span>
            <progress
              className="h-2 flex-1"
              max={count}
              value={stars[star]}
              aria-label={`${star} star ratings`}
            />
            <span className="w-8 text-right text-muted-foreground">
              {stars[star]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A course's rating summary and its visible reviews, newest first, each with
 * Respond (or Edit response and Delete response) for the course's
 * instructors. The summary is core-api's, the list and responses
 * instructor-api's.
 */
export function ReviewsScreen({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const query = useInfiniteQuery(
    trpc.review.list.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const coreApi = useCoreApi();
  const summaryQuery = useQuery(
    coreApi.review.summary.queryOptions({ courseId }),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const [status, setStatus] = useState<string | null>(null);

  // One alert and one retry for the page, whichever of the two failed.
  const listFailed = query.isError && !query.isFetchNextPageError;
  if (summaryQuery.isError || listFailed) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load the reviews"
        onRetry={() => {
          if (summaryQuery.isError) {
            void summaryQuery.refetch();
          }
          if (listFailed) {
            void query.refetch();
          }
        }}
      >
        {apiErrorMessage(
          summaryQuery.isError ? summaryQuery.error : query.error,
        )}
      </ErrorAlert>
    );
  }

  return (
    <div className="space-y-6">
      <StatusMessage message={status} />
      <Summary isPending={summaryQuery.isPending} data={summaryQuery.data} />

      {query.isPending ? (
        <LoadingState label="Loading reviews…" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet.</p>
      ) : (
        <>
          <ul className="divide-y rounded-xl border">
            {items.map((item) => (
              <li key={item.reviewerId} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words [overflow-wrap:anywhere] font-medium">
                      {item.reviewerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span
                        role="img"
                        aria-label={`${item.rating} out of 5 stars`}
                      >
                        {`${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}`}
                      </span>{' '}
                      · {date(item.createdAt)}
                      {item.editedAt ? ' · edited' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <ResponseDialog
                      courseId={courseId}
                      reviewerId={item.reviewerId}
                      reviewerName={item.reviewerName}
                      existing={item.response?.text}
                      trigger={
                        <Button
                          id={respondButtonId(item.reviewerId)}
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`${item.response ? 'Edit response to' : 'Respond to'} ${item.reviewerName}'s review`}
                        >
                          {item.response ? 'Edit response' : 'Respond'}
                        </Button>
                      }
                    />
                    {item.response && (
                      <DeleteResponseDialog
                        courseId={courseId}
                        reviewerId={item.reviewerId}
                        onDeleted={() => setStatus('Response deleted')}
                        trigger={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Delete response to ${item.reviewerName}'s review`}
                          >
                            Delete response
                          </Button>
                        }
                      />
                    )}
                  </div>
                </div>
                {item.text && (
                  <p className="whitespace-pre-line break-words [overflow-wrap:anywhere] text-sm">
                    {item.text}
                  </p>
                )}
                {item.response && (
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">
                      {`Response from ${item.response.byName} · ${date(item.response.at)}`}
                    </p>
                    <p className="mt-1 whitespace-pre-line break-words [overflow-wrap:anywhere]">
                      {item.response.text}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {query.isFetchNextPageError ? (
            <ErrorAlert
              type="error"
              header="Couldn't load more reviews"
              onRetry={() => void query.fetchNextPage()}
            >
              {apiErrorMessage(query.error)}
            </ErrorAlert>
          ) : query.hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
