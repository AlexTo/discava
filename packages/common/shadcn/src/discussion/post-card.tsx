/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { relativeTime } from '@discava/common-web-utils/discussion';
import type { ReactNode } from 'react';
import { Badge } from '#components/ui/badge';
import { PostText } from './post-text';

export interface PostCardPost {
  state: 'shown' | 'hidden' | 'deleted';
  authorName?: string;
  authorIsInstructor?: boolean;
  title?: string;
  body?: string;
  createdAt?: string;
  voteCount?: number;
  // An answer to the course's first-lesson prompt.
  promptAnswer?: boolean;
}

// One post: who wrote it and when, its text and upvotes, with the controls
// (`children`) beneath. A hidden or deleted post is only its placeholder: no
// name, time or text. Presentational; the portals supply the data.
export function PostCard({
  post,
  showTitle = false,
  action = 'posted',
  children,
}: {
  post: PostCardPost;
  showTitle?: boolean;
  // The verb before the time: "asked" for a question, "replied" for a reply.
  action?: string;
  children?: ReactNode;
}) {
  if (post.state === 'hidden' || post.state === 'deleted') {
    return (
      <p className="text-sm italic text-muted-foreground">
        {post.state === 'hidden'
          ? 'This post was hidden by an instructor.'
          : 'This post was deleted.'}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {(showTitle && post.title) || post.promptAnswer ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {showTitle && post.title ? (
            <h4 className="break-words font-medium">{post.title}</h4>
          ) : null}
          {post.promptAnswer ? (
            <Badge variant="secondary">Answer to the course prompt</Badge>
          ) : null}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{post.authorName}</span>
        {post.authorIsInstructor ? (
          <Badge variant="secondary">Instructor</Badge>
        ) : null}
        {post.createdAt ? (
          <time
            dateTime={post.createdAt}
            title={new Date(post.createdAt).toLocaleString()}
          >
            {action} {relativeTime(post.createdAt)}
          </time>
        ) : null}
        {post.voteCount !== undefined ? (
          <span>
            {post.voteCount} {post.voteCount === 1 ? 'upvote' : 'upvotes'}
          </span>
        ) : null}
      </p>
      {post.body !== undefined ? <PostText>{post.body}</PostText> : null}
      {children}
    </div>
  );
}
