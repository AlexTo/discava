/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
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
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { PostCard } from '@discava/common-shadcn/discussion/post-card';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { DISCUSSION_BODY_MAX } from '@discava/common-web-utils/discussion';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../../../../components/alert';
import { useCoreApi } from '../../../../../hooks/useCoreApi';
import { usePostId } from './post-id';
import type { LessonRef } from './question-form';

interface Post {
  postId: string;
  threadId: string;
  kind: 'question' | 'reply';
  state: 'shown' | 'hidden' | 'deleted';
  authorName?: string;
  authorIsInstructor?: boolean;
  title?: string;
  body?: string;
  createdAt?: string;
  voteCount?: number;
  upvotedByMe?: boolean;
  mine?: boolean;
}

// The buttons under one shown post. An archived course keeps only Delete.
function PostControls({
  lesson,
  post,
  readOnly,
  canAccept,
  accepted,
  onError,
}: {
  lesson: LessonRef;
  post: Post;
  readOnly: boolean;
  canAccept: boolean;
  accepted: boolean;
  onError: (error: unknown) => void;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const [reported, setReported] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = { ...lesson, threadId: post.threadId, postId: post.postId };
  const settings = {
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: trpc.discussion.thread.pathKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.discussion.listQuestions.pathKey(),
        }),
      ]),
    onError,
  };
  const vote = useMutation(trpc.discussion.vote.mutationOptions(settings));
  const accept = useMutation(trpc.discussion.accept.mutationOptions(settings));
  const removeOwn = useMutation(
    trpc.discussion.removeOwn.mutationOptions(settings),
  );
  const report = useMutation(
    trpc.discussion.report.mutationOptions({
      onSuccess: () => setReported(true),
      onError,
    }),
  );
  const busy =
    vote.isPending ||
    accept.isPending ||
    removeOwn.isPending ||
    report.isPending;
  const noun = post.kind === 'question' ? 'question' : 'reply';

  return (
    <div className="flex flex-wrap gap-2">
      {!post.mine && !readOnly ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => vote.mutate({ ...ref, voted: !post.upvotedByMe })}
          >
            {post.upvotedByMe ? 'Remove upvote' : 'Upvote'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || reported}
            onClick={() => report.mutate(ref)}
          >
            {reported ? 'Reported' : 'Report'}
          </Button>
        </>
      ) : null}
      {canAccept ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            accept.mutate({
              ...lesson,
              threadId: post.threadId,
              postId: accepted ? null : post.postId,
            })
          }
        >
          {accepted ? 'Remove answer' : 'Mark as answer'}
        </Button>
      ) : null}
      {post.mine ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
          <AlertDialog
            open={confirmingDelete}
            onOpenChange={setConfirmingDelete}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your {noun}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {post.kind === 'question'
                    ? 'Your question will be deleted, and so will its accepted answer. This cannot be undone.'
                    : 'Your reply will be deleted. This cannot be undone.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => removeOwn.mutate(ref)}>
                  Delete {noun}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}

// Reply to the question. An error keeps what was typed.
function ReplyForm({
  lesson,
  threadId,
}: {
  lesson: LessonRef;
  threadId: string;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const [postId, renewPostId] = usePostId();
  const [body, setBody] = useState('');
  const reply = useMutation(
    trpc.discussion.reply.mutationOptions({
      onSuccess: () => {
        setBody('');
        renewPostId();
        void queryClient.invalidateQueries({
          queryKey: trpc.discussion.thread.pathKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.discussion.listQuestions.pathKey(),
        });
      },
    }),
  );
  const empty = body.trim() === '';

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !reply.isPending) {
          reply.mutate({ ...lesson, threadId, postId, body });
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="reply-body">Your reply</Label>
        <Textarea
          id="reply-body"
          value={body}
          rows={3}
          maxLength={DISCUSSION_BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {body.length} / {DISCUSSION_BODY_MAX.toLocaleString('en-US')}
        </p>
      </div>
      {reply.isError ? (
        <Alert type="error" header="Couldn't post your reply">
          {apiErrorMessage(reply.error)}
        </Alert>
      ) : null}
      <Button type="submit" disabled={empty || reply.isPending}>
        Post reply
      </Button>
    </form>
  );
}

// One question with its replies, oldest first, the accepted answer above them
// and not repeated.
export function ThreadView({
  lesson,
  threadId,
  readOnly,
  onBack,
}: {
  lesson: LessonRef;
  threadId: string;
  readOnly: boolean;
  onBack: () => void;
}) {
  const trpc = useCoreApi();
  const [actionError, setActionError] = useState<unknown>();
  const threadQuery = useInfiniteQuery(
    trpc.discussion.thread.infiniteQueryOptions(
      { ...lesson, threadId },
      { getNextPageParam: (lastPage) => lastPage.cursor ?? undefined },
    ),
  );

  const back = (
    <Button type="button" variant="outline" size="sm" onClick={onBack}>
      Back to questions
    </Button>
  );

  if (threadQuery.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading question">
        {back}
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (threadQuery.isError) {
    return (
      <div className="space-y-3">
        {back}
        <Alert type="error" header="Couldn't load the question">
          {apiErrorMessage(threadQuery.error)}
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() => threadQuery.refetch()}
          >
            Try again
          </Button>
        </Alert>
      </div>
    );
  }

  const { question, accepted } = threadQuery.data.pages[0];
  const replies = threadQuery.data.pages.flatMap((page) => page.replies);
  const open = question.state === 'shown';
  const iAsked = !!question.mine;

  const post = (reply: Post, isAccepted: boolean) => (
    <PostCard post={reply} action="replied">
      {reply.state === 'shown' ? (
        <PostControls
          lesson={lesson}
          post={reply}
          readOnly={readOnly}
          canAccept={iAsked && !readOnly}
          accepted={isAccepted}
          onError={setActionError}
        />
      ) : null}
    </PostCard>
  );

  return (
    <div className="space-y-4">
      {back}
      <PostCard post={question} showTitle action="asked">
        {open ? (
          <PostControls
            lesson={lesson}
            post={question}
            readOnly={readOnly}
            canAccept={false}
            accepted={false}
            onError={setActionError}
          />
        ) : null}
      </PostCard>
      {actionError ? (
        <Alert type="error" header="That didn't work">
          {apiErrorMessage(actionError)}
        </Alert>
      ) : null}
      {open ? (
        <>
          {accepted ? (
            <div className="space-y-1 border-l-2 border-emerald-500 pl-3">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Accepted answer
              </p>
              {post(accepted, true)}
            </div>
          ) : null}
          <ul className="space-y-4 border-t pt-4">
            {replies.map((reply) => (
              <li key={reply.postId}>{post(reply, false)}</li>
            ))}
          </ul>
          {threadQuery.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={threadQuery.isFetchingNextPage}
                onClick={() => threadQuery.fetchNextPage()}
              >
                {threadQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
          {readOnly ? null : <ReplyForm lesson={lesson} threadId={threadId} />}
        </>
      ) : null}
    </div>
  );
}
