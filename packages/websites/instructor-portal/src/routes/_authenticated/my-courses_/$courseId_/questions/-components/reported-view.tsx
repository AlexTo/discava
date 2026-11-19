/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { PostText } from '@discava/common-shadcn/discussion/post-text';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { lessonStateLabel, useCourseLessons } from './lessons';
import { DeletePostButton, useModeration } from './moderation';
import { PagedList } from './paged-list';

// Reported questions and replies, oldest first, each with the moderation
// actions. Never who reported.
export function ReportedView({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const lessons = useCourseLessons(courseId);
  const [actionError, setActionError] = useState<unknown>();
  const moderation = useModeration(setActionError);
  const query = useInfiniteQuery(
    trpc.discussion.reported.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      {actionError ? (
        <Alert type="error" header="That didn't work">
          {apiErrorMessage(actionError)}
        </Alert>
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
            <li key={row.postId} className="space-y-2 p-4">
              <p className="text-xs text-muted-foreground">
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
