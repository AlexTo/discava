/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
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
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useReturnFocus } from '@discava/common-shadcn/hooks/use-return-focus';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  onRemoved,
  onCloseAutoFocus,
}: {
  courseId: string;
  review: ReviewToRemove | undefined;
  onClose: () => void;
  onRemoved: (reviewerId: string) => void;
  onCloseAutoFocus: (event: Event) => void;
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
  const guard = useDiscardGuard({
    dirty: reason.trim() !== '',
    discard: close,
  });
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
    onRemoved(review.reviewerId);
    close();
    void queryClient.invalidateQueries(trpc.review.pathFilter());
  };

  return (
    <Dialog
      open={review !== undefined}
      onOpenChange={(open) => !open && guard.requestClose()}
    >
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
        {...guard.contentProps}
      >
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
                id="removal-reason-count"
                className="text-xs text-muted-foreground"
              >{`${reason.length}/${REASON_MAX}`}</span>
            </div>
            <Textarea
              id="removal-reason"
              aria-describedby="removal-reason-count"
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
            <PendingButton
              type="submit"
              variant="destructive"
              disabled={reason.trim() === ''}
              pending={remove.isPending}
              pendingLabel="Removing…"
            >
              Remove review
            </PendingButton>
          </DialogFooter>
        </form>
        {guard.confirmation}
      </DialogContent>
    </Dialog>
  );
}

function CourseReviews({
  courseId,
  onAnnounce,
}: {
  courseId: string;
  onAnnounce: (message: string) => void;
}) {
  const trpc = useAdminApi();
  const [removing, setRemoving] = useState<ReviewToRemove>();
  const returnFocus = useReturnFocus(removing !== undefined);
  const list = useRef<HTMLUListElement>(null);
  const reviewItems = useRef(new Map<string, HTMLLIElement>());
  const removedId = useRef<string>(undefined);
  const focusFirstNew = useRef<number>(undefined);
  const query = useInfiniteQuery(
    trpc.review.list.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  // After Load more, focus the first review it added.
  useEffect(() => {
    const index = focusFirstNew.current;
    const added = index === undefined ? undefined : items[index];
    if (added) {
      focusFirstNew.current = undefined;
      reviewItems.current.get(added.reviewerId)?.focus();
    }
  }, [items]);

  const loadMore = async () => {
    const before = items.length;
    const result = await query.fetchNextPage();
    const after =
      result.data?.pages.reduce((n, page) => n + page.items.length, 0) ?? 0;
    if (after > before) {
      focusFirstNew.current = before;
    } else {
      list.current?.focus();
    }
  };

  if (query.isPending) {
    return <LoadingState label="Loading the reviews…" />;
  }
  if (query.isError) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p className="text-destructive">
          {apiErrorMessage(query.error, "Couldn't load the reviews.")}
        </p>
        <PendingButton
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          pending={query.isFetching}
          pendingLabel="Trying again…"
        >
          Try again
        </PendingButton>
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No reviews yet.</p>;
  }

  return (
    <>
      <ul
        ref={list}
        tabIndex={-1}
        aria-label="Reviews"
        className="divide-y rounded-xl border focus-visible:outline-2 focus-visible:outline-ring"
        aria-busy={query.isFetchingNextPage}
      >
        {items.map((item) => (
          <li
            key={item.reviewerId}
            ref={(element) => {
              if (element) {
                reviewItems.current.set(item.reviewerId, element);
              } else {
                reviewItems.current.delete(item.reviewerId);
              }
            }}
            tabIndex={-1}
            aria-label={`Review by ${item.reviewerName}`}
            className="space-y-3 p-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="min-w-0 break-words font-medium">
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
              <p className="whitespace-pre-line break-words text-sm [overflow-wrap:anywhere]">
                {item.text}
              </p>
            )}
            {item.response && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="min-w-0 break-words text-xs font-medium text-muted-foreground">
                  {`Response from ${item.response.byName} · ${date(item.response.at)}`}
                </p>
                <p className="mt-1 whitespace-pre-line break-words [overflow-wrap:anywhere]">
                  {item.response.text}
                </p>
              </div>
            )}
            {item.status === 'removed' && (
              <p className="text-sm text-muted-foreground">
                {`Removed${item.removedAt ? ` on ${date(item.removedAt)}` : ''}: `}
                <span className="break-words text-foreground [overflow-wrap:anywhere]">
                  {item.removedReason}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <PendingButton
          variant="outline"
          onClick={loadMore}
          pending={query.isFetchingNextPage}
          pendingLabel="Loading more…"
        >
          Load more
        </PendingButton>
      )}
      <RemoveDialog
        courseId={courseId}
        review={removing}
        onClose={() => setRemoving(undefined)}
        onRemoved={(reviewerId) => {
          removedId.current = reviewerId;
          onAnnounce('Review removed.');
        }}
        onCloseAutoFocus={(event) => {
          const element =
            removedId.current && reviewItems.current.get(removedId.current);
          removedId.current = undefined;
          if (element) {
            event.preventDefault();
            element.focus();
            return;
          }
          returnFocus.onCloseAutoFocus(event);
        }}
      />
    </>
  );
}

/**
 * Admin removal of course reviews: pick a published or archived course, then
 * see its reviews of every status and remove a visible one with a reason.
 */
export function ReviewsScreen() {
  usePageTitle('Reviews');
  const trpc = useAdminApi();
  const [courseId, setCourseId] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const picker = useRef<HTMLSelectElement>(null);
  const courses = useInfiniteQuery(
    trpc.review.courses.infiniteQueryOptions(
      {},
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const items = courses.data?.pages.flatMap((page) => page.items) ?? [];

  // More courses can unmount its own button, so focus goes to the picker.
  const loadMoreCourses = async () => {
    await courses.fetchNextPage();
    picker.current?.focus();
  };

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

      <StatusMessage message={announcement} visuallyHidden />

      {courses.isPending && <LoadingState label="Loading the courses…" />}
      {courses.isError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-destructive">
            {apiErrorMessage(courses.error, "Couldn't load the courses.")}
          </p>
          <PendingButton
            variant="outline"
            size="sm"
            onClick={() => courses.refetch()}
            pending={courses.isFetching}
            pendingLabel="Trying again…"
          >
            Try again
          </PendingButton>
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
              ref={picker}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={courseId}
              aria-busy={courses.isFetchingNextPage}
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
            <PendingButton
              variant="outline"
              onClick={loadMoreCourses}
              pending={courses.isFetchingNextPage}
              pendingLabel="Loading more…"
            >
              More courses
            </PendingButton>
          )}
        </div>
      )}

      {courseId && (
        <CourseReviews
          key={courseId}
          courseId={courseId}
          onAnnounce={setAnnouncement}
        />
      )}
    </div>
  );
}
