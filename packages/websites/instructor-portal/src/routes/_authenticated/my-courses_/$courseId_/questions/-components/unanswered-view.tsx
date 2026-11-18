/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { PostText } from '@discava/common-shadcn/discussion/post-text';
import { relativeTime } from '@discava/common-web-utils/discussion';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { lessonStateLabel, useCourseLessons } from './lessons';
import { PagedList } from './paged-list';
import { ThreadDialog } from './thread-dialog';

// Questions nobody on the course's staff has answered, oldest first.
export function UnansweredView({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const lessons = useCourseLessons(courseId);
  const [open, setOpen] = useState<string>();
  const query = useInfiniteQuery(
    trpc.discussion.unanswered.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const opened = rows.find((row) => row.postId === open);
  const stateOf = (lessonId: string) =>
    lessons.data?.lessons.find((l) => l.lessonId === lessonId)?.state;

  return (
    <>
      <PagedList
        query={query}
        rows={rows}
        label="Unanswered questions"
        emptyText="All questions are answered."
        errorText="Couldn't load the questions."
        renderRow={(row) => {
          const state = lessonStateLabel(stateOf(row.lessonId));
          return (
            <li key={row.postId} className="space-y-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <PostText>{row.title ?? ''}</PostText>
                  <p className="text-xs text-muted-foreground">
                    {row.lessonTitle}
                    {state ? ` (${state})` : ''} · {row.authorName} ·{' '}
                    {relativeTime(row.createdAt)} ·{' '}
                    {row.replyCount === 1
                      ? '1 reply'
                      : `${row.replyCount ?? 0} replies`}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Open question ${row.title ?? ''}`}
                  onClick={() => setOpen(row.postId)}
                >
                  Open
                </Button>
              </div>
            </li>
          );
        }}
      />
      {opened ? (
        <ThreadDialog
          lesson={{
            courseId,
            moduleId: opened.moduleId,
            lessonId: opened.lessonId,
          }}
          threadId={opened.threadId}
          lessonState={stateOf(opened.lessonId)}
          courseArchived={lessons.data?.courseArchived ?? false}
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </>
  );
}
