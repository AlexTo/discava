/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useAdminApi } from '../../api';

export const REASON_MAX = 200;

const date = (iso: string) => new Date(iso).toLocaleDateString();

interface ReviewToRemove {
  reviewerId: string;
  reviewerName: string;
}

// Asks why, then removes the review. A failed removal keeps the dialog open
// with what was typed.
function RemoveDialog({
  courseId,
  review,
  onClose,
}: {
  courseId: string;
  review: ReviewToRemove | undefined;
  onClose: () => void;
}) {
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const remove = useMutation(trpc.review.remove.mutationOptions());
  const [reason, setReason] = useState('');

  const close = () => {
    setReason('');
    remove.reset();
    onClose();
  };
  const submit = async () => {
    if (!review || remove.isPending) {
      return;
    }
    try {
      await remove.mutateAsync({
        courseId,
        reviewerId: review.reviewerId,
        reason: reason.trim(),
      });
    } catch {
      // Shown in the dialog.
      return;
    }
    close();
    void queryClient.invalidateQueries(trpc.review.pathFilter());
  };

  return (
    <Dialog
      open={review !== undefined}
      onOpenChange={(open) => !open && close()}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove review</DialogTitle>
            <DialogDescription>
              {`${review?.reviewerName ?? 'The student'}'s review will no longer count towards the course's rating or be shown to anyone. This can't be undone.`}
            </DialogDescription>
          </DialogHeader>

          {remove.isError && (
            <ErrorAlert type="error" header="Couldn't remove the review">
              {apiErrorMessage(remove.error)}
            </ErrorAlert>
          )}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="removal-reason">Reason</Label>
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >{`${reason.length}/${REASON_MAX}`}</span>
            </div>
            <Textarea
              id="removal-reason"
              value={reason}
              maxLength={REASON_MAX}
              rows={4}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={reason.trim() === '' || remove.isPending}
            >
              {remove.isPending ? 'Removing…' : 'Remove review'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CourseReviews({ courseId }: { courseId: string }) {
  const trpc = useAdminApi();
  const [removing, setRemoving] = useState<ReviewToRemove>();
  const query = useInfiniteQuery(
    trpc.review.list.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isPending) {
    return <Spinner />;
  }
  if (query.isError) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p className="text-destructive">
          {apiErrorMessage(query.error, "Couldn't load the reviews.")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No reviews yet.</p>;
  }

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {items.map((item) => (
          <li key={item.reviewerId} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {item.reviewerName}{' '}
                  {item.status === 'removed' && (
                    <Badge variant="outline">Removed</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span role="img" aria-label={`${item.rating} out of 5 stars`}>
                    {`${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}`}
                  </span>{' '}
                  · {date(item.createdAt)}
                  {item.editedAt ? ' · edited' : ''}
                </p>
              </div>
              {item.status === 'visible' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${item.reviewerName}'s review`}
                  onClick={() =>
                    setRemoving({
                      reviewerId: item.reviewerId,
                      reviewerName: item.reviewerName,
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
            {item.text && (
              <p className="whitespace-pre-line text-sm">{item.text}</p>
            )}
            {item.response && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  {`Response from ${item.response.byName} · ${date(item.response.at)}`}
                </p>
                <p className="mt-1 whitespace-pre-line">{item.response.text}</p>
              </div>
            )}
            {item.status === 'removed' && (
              <p className="text-sm text-muted-foreground">
                {`Removed${item.removedAt ? ` on ${date(item.removedAt)}` : ''}: `}
                <span className="text-foreground">{item.removedReason}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="outline"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
      <RemoveDialog
        courseId={courseId}
        review={removing}
        onClose={() => setRemoving(undefined)}
      />
    </>
  );
}

/**
 * Admin removal of course reviews: pick a published or archived course, then
 * see its reviews of every status and remove a visible one with a reason.
 */
export function ReviewsScreen() {
  const trpc = useAdminApi();
  const [courseId, setCourseId] = useState('');
  const courses = useInfiniteQuery(
    trpc.review.courses.infiniteQueryOptions(
      {},
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const items = courses.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Remove a course review that breaks the rules. A removed review stays
          on record with its reason, no longer counts towards the course's
          rating, and its author can't post another.
        </p>
      </header>

      {courses.isPending && <Spinner />}
      {courses.isError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-destructive">
            {apiErrorMessage(courses.error, "Couldn't load the courses.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => courses.refetch()}
            disabled={courses.isFetching}
          >
            Try again
          </Button>
        </div>
      )}
      {courses.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No published or archived courses yet.
        </p>
      )}
      {items.length > 0 && (
        <div className="flex max-w-xl items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="review-course">Course</Label>
            <select
              id="review-course"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              <option value="">Choose a course</option>
              {items.map((course) => (
                <option key={course.courseId} value={course.courseId}>
                  {`${course.title}${course.status === 'archived' ? ' (archived)' : ''} · ${course.ratingCount} ${course.ratingCount === 1 ? 'rating' : 'ratings'}`}
                </option>
              ))}
            </select>
          </div>
          {courses.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => courses.fetchNextPage()}
              disabled={courses.isFetchingNextPage}
            >
              More courses
            </Button>
          )}
        </div>
      )}

      {courseId && <CourseReviews key={courseId} courseId={courseId} />}
    </div>
  );
}
