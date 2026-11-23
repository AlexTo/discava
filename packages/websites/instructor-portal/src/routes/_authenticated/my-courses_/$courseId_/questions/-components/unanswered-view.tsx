/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { PostText } from '@discava/common-shadcn/discussion/post-text';
import { relativeTime } from '@discava/common-web-utils/discussion';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { lessonStateLabel, useCourseLessons } from './lessons';
import { PagedList } from './paged-list';
import { ThreadDialog } from './thread-dialog';

// Questions nobody on the course's staff has answered, oldest first.
export function UnansweredView({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const lessons = useCourseLessons(courseId);
  const query = useInfiniteQuery(
    trpc.discussion.unanswered.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.cursor },
    ),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  // The row is kept, not looked up in the list: answering the question takes
  // it out of the queue, which must not close the thread being answered.
  const [opened, setOpened] = useState<(typeof rows)[number]>();
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
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
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
                  onClick={() => setOpened(row)}
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
          onClose={() => setOpened(undefined)}
        />
      ) : null}
    </>
  );
}
