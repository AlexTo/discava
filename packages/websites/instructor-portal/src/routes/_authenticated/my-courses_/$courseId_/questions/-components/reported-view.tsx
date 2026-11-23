/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { PostText } from '@discava/common-shadcn/discussion/post-text';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { lessonStateLabel, useCourseLessons } from './lessons';
import {
  DeletePostButton,
  type ModerationAction,
  useModeration,
} from './moderation';
import { PagedList } from './paged-list';

const DONE: Record<ModerationAction, string> = {
  dismissReports: 'Report dismissed',
  hide: 'Post hidden',
  unhide: 'Post unhidden',
  remove: 'Post deleted',
};

// Reported questions and replies, oldest first, each with the moderation
// actions. Never who reported.
export function ReportedView({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const lessons = useCourseLessons(courseId);
  const [actionError, setActionError] = useState<unknown>();
  const [status, setStatus] = useState<string | null>(null);
  // The row acted on, and the one after it: focus goes there once the first
  // has left the list.
  const [moved, setMoved] = useState<{ removed: string; next?: string }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const rowsRef = useRef<{ postId: string }[]>([]);
  const moderation = useModeration(setActionError, (action, ref) => {
    setActionError(undefined);
    setStatus(DONE[action]);
    const i = rowsRef.current.findIndex((r) => r.postId === ref.postId);
    setMoved({
      removed: ref.postId,
      next: rowsRef.current[i + 1]?.postId ?? rowsRef.current[i - 1]?.postId,
    });
  });
  const query = useInfiniteQuery(
    trpc.discussion.reported.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  rowsRef.current = rows;

  useEffect(() => {
    if (!moved || rows.some((row) => row.postId === moved.removed)) {
      return;
    }
    const next = moved.next
      ? document.getElementById(`reported-${moved.next}`)
      : null;
    (next?.querySelector('button') ?? heading.current)?.focus();
    setMoved(undefined);
  }, [moved, rows]);

  return (
    <div className="space-y-4">
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        Reported posts
      </h2>
      <StatusMessage message={status} visuallyHidden />
      {actionError ? (
        <ErrorAlert type="error" header="That didn't work">
          {apiErrorMessage(actionError)}
        </ErrorAlert>
      ) : null}
      <PagedList
        query={query}
        rows={rows}
        label="Reported posts"
        emptyText="No reported posts."
        errorText="Couldn't load the reported posts."
        renderRow={(row) => {
          const ref = {
            courseId,
            moduleId: row.moduleId,
            lessonId: row.lessonId,
            threadId: row.threadId,
            postId: row.postId,
          };
          const state = lessonStateLabel(
            lessons.data?.lessons.find((l) => l.lessonId === row.lessonId)
              ?.state,
          );
          return (
            <li
              key={row.postId}
              id={`reported-${row.postId}`}
              className="space-y-2 p-4"
            >
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {row.kind === 'question' ? 'Question' : 'Reply'} ·{' '}
                {row.authorName} · {row.lessonTitle}
                {state ? ` (${state})` : ''} ·{' '}
                {row.reportCount === 1
                  ? '1 report'
                  : `${row.reportCount} reports`}
              </p>
              {row.title ? <PostText>{row.title}</PostText> : null}
              {row.body ? <PostText>{row.body}</PostText> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={moderation.busy}
                  onClick={() => moderation.hide.mutate(ref)}
                >
                  Hide
                </Button>
                <DeletePostButton
                  kind={row.kind}
                  disabled={moderation.busy}
                  onConfirm={() => moderation.remove.mutate(ref)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={moderation.busy}
                  onClick={() => moderation.dismissReports.mutate(ref)}
                >
                  Dismiss reports
                </Button>
              </div>
            </li>
          );
        }}
      />
    </div>
  );
}
