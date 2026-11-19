/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Label } from '@discava/common-shadcn/components/ui/label';
import {
  RadioGroup,
  RadioGroupItem,
} from '@discava/common-shadcn/components/ui/radio-group';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useCoreApi } from '../../../../api';
import { formatReviewDate } from './review-date';

const TEXT_MAX = 2000;

const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code;

interface OwnReview {
  rating: number;
  text?: string;
  createdAt: string;
  editedAt?: string;
  version: number;
  status: 'visible' | 'removed';
  removedReason?: string;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-4 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`}
        />
      ))}
    </span>
  );
}

// The rating radios and text area, shared by posting and editing. Calls
// `onSubmit` once per submit however fast the button is clicked.
function ReviewFields({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: { rating: number; text?: string };
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (value: { rating: number; text?: string }) => void;
  onCancel?: () => void;
}) {
  const [rating, setRating] = useState<number | undefined>(initial?.rating);
  const [text, setText] = useState(initial?.text ?? '');
  const sending = useRef(false);
  const errored = error !== null && error !== undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (rating === undefined || sending.current) {
      return;
    }
    sending.current = true;
    const trimmed = text.trim();
    onSubmit({ rating, ...(trimmed !== '' && { text: trimmed }) });
  };
  // A failed call lets the student try again.
  if (!pending && errored) {
    sending.current = false;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Your rating</legend>
        <RadioGroup
          aria-required
          orientation="horizontal"
          className="flex flex-wrap gap-4"
          value={rating === undefined ? '' : String(rating)}
          onValueChange={(value) => setRating(Number(value))}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <RadioGroupItem value={String(n)} id={`review-rating-${n}`} />
              <Label htmlFor={`review-rating-${n}`}>
                {n} {n === 1 ? 'star' : 'stars'}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="review-text">Your review (optional)</Label>
        <Textarea
          id="review-text"
          value={text}
          maxLength={TEXT_MAX}
          rows={4}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {text.length} / {TEXT_MAX.toLocaleString('en-US')}
        </p>
      </div>
      {errored ? (
        <ErrorAlert type="error" header="Couldn't save your review">
          {apiErrorMessage(error)}
        </ErrorAlert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={rating === undefined || pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

// What the student can do about reviewing this course: sign in, enrol, post
// a review, or see and change their own. `review.mine` decides which; every
// save refetches the summary and the list.
export function ReviewForm({ courseId }: { courseId: string }) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const here = useLocation().href;
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const enrolmentQuery = useQuery(
    trpc.course.myEnrolment.queryOptions(
      { courseId },
      { enabled: isAuthenticated },
    ),
  );
  const enrolment = enrolmentQuery.data;
  const dropped = enrolment?.status === 'dropped';
  // A student who dropped the course keeps, and may edit or delete, the review
  // they wrote; they just can't post a new one.
  const mineQuery = useQuery(
    trpc.review.mine.queryOptions(
      { courseId },
      { enabled: isAuthenticated && !!enrolment },
    ),
  );

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.review.summary.queryKey({ courseId }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.review.list.pathKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.course.publicList.pathKey(),
      }),
    ]);
  const saved = (review: OwnReview) => {
    queryClient.setQueryData(trpc.review.mine.queryKey({ courseId }), review);
    setEditing(false);
    void refresh();
  };

  const post = useMutation(
    trpc.review.post.mutationOptions({ onSuccess: saved }),
  );
  const edit = useMutation(
    trpc.review.edit.mutationOptions({ onSuccess: saved }),
  );
  const remove = useMutation(
    trpc.review.delete.mutationOptions({
      onSuccess: () => {
        queryClient.setQueryData(trpc.review.mine.queryKey({ courseId }), null);
        setConfirmingDelete(false);
        void refresh();
      },
      // Close the dialog so the error (or the reload prompt for a CONFLICT)
      // shows on the page instead of behind the overlay.
      onError: () => setConfirmingDelete(false),
    }),
  );

  const reload = () => {
    edit.reset();
    remove.reset();
    setEditing(false);
    void mineQuery.refetch();
    void refresh();
  };

  if (!isAuthenticated) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link
          to="/signin"
          search={{ redirect: here }}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in and enrol to review
        </Link>
      </p>
    );
  }
  if (enrolmentQuery.isPending) {
    return <Spinner />;
  }
  if (enrolmentQuery.isError) {
    // The enrolment action above already says so.
    return null;
  }
  if (!enrolment) {
    return (
      <p className="text-sm text-muted-foreground">
        Enrol in this course to review it
      </p>
    );
  }
  if (mineQuery.isPending) {
    return <Spinner />;
  }
  if (mineQuery.isError) {
    return (
      <ErrorAlert type="error" header="Couldn't load your review">
        {apiErrorMessage(mineQuery.error)}
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => mineQuery.refetch()}
        >
          Retry
        </Button>
      </ErrorAlert>
    );
  }

  const mine = mineQuery.data;
  if (mine?.status === 'removed') {
    return (
      <ErrorAlert header="Your review was removed by a moderator">
        {mine.removedReason ? `Reason: ${mine.removedReason}` : ''}
      </ErrorAlert>
    );
  }

  if (!mine) {
    if (dropped) {
      return null;
    }
    return (
      <ReviewFields
        submitLabel="Post review"
        pending={post.isPending}
        error={post.error}
        onSubmit={(value) => post.mutate({ courseId, ...value })}
      />
    );
  }

  const conflict =
    errorCode(edit.error) === 'CONFLICT' ||
    errorCode(remove.error) === 'CONFLICT';
  const conflictNotice = conflict ? (
    <ErrorAlert type="error" header="Your review changed; reload it">
      <Button className="mt-2" size="sm" variant="outline" onClick={reload}>
        Reload
      </Button>
    </ErrorAlert>
  ) : null;

  if (editing) {
    return (
      <div className="space-y-3">
        {conflictNotice}
        <ReviewFields
          initial={mine}
          submitLabel="Save changes"
          pending={edit.isPending}
          error={conflict ? null : edit.error}
          onSubmit={(value) =>
            edit.mutate({ courseId, ...value, version: mine.version })
          }
          onCancel={() => {
            edit.reset();
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {conflictNotice}
      <p className="text-sm font-medium">Your review</p>
      <div className="flex items-center gap-2">
        <Stars rating={mine.rating} />
        <span className="sr-only">
          {mine.rating} {mine.rating === 1 ? 'star' : 'stars'}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatReviewDate(mine.createdAt)}
          {mine.editedAt ? ' · edited' : ''}
        </span>
      </div>
      {mine.text ? (
        <p className="whitespace-pre-line break-words text-sm">{mine.text}</p>
      ) : null}
      {remove.isError && !conflict ? (
        <ErrorAlert type="error" header="Couldn't delete your review">
          {apiErrorMessage(remove.error)}
        </ErrorAlert>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfirmingDelete(true)}
        >
          Delete review
        </Button>
      </div>
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your review?</AlertDialogTitle>
            <AlertDialogDescription>
              Your rating and review will be removed from this course. You can
              post a new one afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!remove.isPending) {
                  remove.mutate({ courseId, version: mine.version });
                }
              }}
            >
              Delete review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
