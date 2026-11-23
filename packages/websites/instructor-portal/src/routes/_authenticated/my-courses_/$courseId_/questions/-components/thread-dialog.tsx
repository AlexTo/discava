/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
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
import { useRef, useState } from 'react';
import { useCoreApi } from '../../../../../../api';
import type { LessonRef, LessonState } from './lessons';
import { DeletePostButton, useModeration } from './moderation';
import { usePostId } from './post-id';

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
}

// Why the thread cannot be answered, or nothing when it can.
const readOnlyReason = (
  courseArchived: boolean,
  lessonState: LessonState | undefined,
) =>
  courseArchived
    ? 'This course is archived, so questions are read-only.'
    : lessonState === 'archived' || lessonState === 'hidden'
      ? `This lesson is ${lessonState}, so students cannot open it and replies are closed.`
      : undefined;

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
  const [status, setStatus] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const reply = useMutation(
    trpc.discussion.reply.mutationOptions({
      onSuccess: () => {
        setBody('');
        setStatus('Reply posted');
        textarea.current?.focus();
        renewPostId();
        void queryClient.invalidateQueries({
          queryKey: trpc.discussion.pathKey(),
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
        <Label htmlFor="instructor-reply-body">Your reply</Label>
        <Textarea
          ref={textarea}
          id="instructor-reply-body"
          aria-describedby="instructor-reply-count"
          value={body}
          rows={3}
          maxLength={DISCUSSION_BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
        />
        <p
          id="instructor-reply-count"
          className="text-xs text-muted-foreground"
        >
          {body.length} / {DISCUSSION_BODY_MAX.toLocaleString('en-US')}
        </p>
      </div>
      <StatusMessage message={status} />
      {reply.isError ? (
        <ErrorAlert type="error" header="Couldn't post your reply">
          {apiErrorMessage(reply.error)}
        </ErrorAlert>
      ) : null}
      <PendingButton
        type="submit"
        pending={reply.isPending}
        pendingLabel="Posting…"
        disabled={empty}
      >
        Post reply
      </PendingButton>
    </form>
  );
}

// A question's thread for the course's staff: every post with its moderation
// controls, hidden posts shown in full with a "Hidden" label, and a reply form
// unless the course or lesson is closed.
export function ThreadDialog({
  lesson,
  threadId,
  lessonState,
  courseArchived,
  headingId,
  onClose,
}: {
  lesson: LessonRef;
  threadId: string;
  lessonState: LessonState | undefined;
  courseArchived: boolean;
  /** The list's heading, where focus lands when its rows are gone. */
  headingId: string;
  onClose: () => void;
}) {
  // The row's open button, and the next row's, read before the dialog takes
  // focus.
  const [opener] = useState(() => {
    const button = document.activeElement;
    return {
      button,
      next: button?.closest('li')?.nextElementSibling ?? null,
    };
  });
  const coreApi = useCoreApi();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<unknown>();
  const moderation = useModeration(setActionError);
  const accept = useMutation(
    coreApi.discussion.accept.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: coreApi.discussion.pathKey(),
        }),
      onError: setActionError,
    }),
  );
  const query = useInfiniteQuery(
    coreApi.discussion.thread.infiniteQueryOptions(
      { ...lesson, threadId },
      { getNextPageParam: (lastPage) => lastPage.cursor ?? undefined },
    ),
  );
  const reason = readOnlyReason(courseArchived, lessonState);
  const busy = moderation.busy || accept.isPending;

  const renderPost = (post: Post, isAccepted: boolean) => {
    const ref = { ...lesson, threadId: post.threadId, postId: post.postId };
    const hidden = post.state === 'hidden';
    return (
      <PostCard
        post={hidden ? { ...post, state: 'shown' } : post}
        showTitle
        headingLevel={3}
        action={post.kind === 'question' ? 'asked' : 'replied'}
      >
        {hidden ? <Badge variant="outline">Hidden</Badge> : null}
        {post.state === 'deleted' ? null : (
          <div className="flex flex-wrap gap-2">
            {post.kind === 'reply' && !reason && post.state === 'shown' ? (
              <PendingButton
                type="button"
                size="sm"
                variant="outline"
                pending={accept.isPending}
                pendingLabel="Marking…"
                disabled={moderation.busy}
                onClick={() =>
                  accept.mutate({
                    ...lesson,
                    threadId,
                    postId: isAccepted ? null : post.postId,
                  })
                }
              >
                {isAccepted ? 'Remove answer' : 'Mark as answer'}
              </PendingButton>
            ) : null}
            <PendingButton
              type="button"
              size="sm"
              variant="outline"
              pending={
                hidden ? moderation.unhide.isPending : moderation.hide.isPending
              }
              pendingLabel={hidden ? 'Unhiding…' : 'Hiding…'}
              disabled={
                moderation.remove.isPending ||
                accept.isPending ||
                (hidden
                  ? moderation.hide.isPending
                  : moderation.unhide.isPending)
              }
              onClick={() =>
                hidden
                  ? moderation.unhide.mutate(ref)
                  : moderation.hide.mutate(ref)
              }
            >
              {hidden ? 'Unhide' : 'Hide'}
            </PendingButton>
            <DeletePostButton
              kind={post.kind}
              disabled={busy}
              onConfirm={() => moderation.remove.mutate(ref)}
            />
          </div>
        )}
      </PostCard>
    );
  };

  let content: React.ReactNode;
  if (query.isPending) {
    content = <Skeleton className="h-14 w-full" />;
  } else if (query.isError) {
    content = (
      <ErrorAlert type="error" header="Couldn't load the question">
        {apiErrorMessage(query.error)}
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => query.refetch()}
        >
          Try again
        </Button>
      </ErrorAlert>
    );
  } else {
    const { question, accepted } = query.data.pages[0];
    const replies = query.data.pages.flatMap((page) => page.replies);
    content = (
      <>
        {renderPost(question, false)}
        {actionError ? (
          <ErrorAlert type="error" header="That didn't work">
            {apiErrorMessage(actionError)}
          </ErrorAlert>
        ) : null}
        {accepted ? (
          <div className="space-y-1 border-l-2 border-emerald-500 pl-3">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Accepted answer
            </p>
            {renderPost(accepted, true)}
          </div>
        ) : null}
        <ul className="space-y-4 border-t pt-4">
          {replies.map((reply) => (
            <li key={reply.postId}>{renderPost(reply, false)}</li>
          ))}
        </ul>
        {query.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            Load more
          </Button>
        ) : null}
        {reason ? (
          <p className="text-sm text-muted-foreground">{reason}</p>
        ) : (
          <ReplyForm lesson={lesson} threadId={threadId} />
        )}
      </>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          const target =
            opener.button?.isConnected && opener.button instanceof HTMLElement
              ? opener.button
              : (opener.next?.querySelector('button') ??
                document.getElementById(headingId));
          if (target instanceof HTMLElement) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Question</DialogTitle>
          <DialogDescription>
            {query.isPending
              ? 'Loading the question.'
              : 'Reply, mark an answer, or moderate the posts.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">{content}</div>
      </DialogContent>
    </Dialog>
  );
}
