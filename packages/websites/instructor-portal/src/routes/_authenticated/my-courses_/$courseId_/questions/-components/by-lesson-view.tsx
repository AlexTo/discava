/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { PostCard } from '@discava/common-shadcn/discussion/post-card';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCoreApi } from '../../../../../../api';
import { lessonStateLabel, useCourseLessons } from './lessons';
import { PagedList } from './paged-list';
import { ThreadDialog } from './thread-dialog';

function LessonQuestions({
  courseId,
  moduleId,
  lessonId,
  lessonState,
  courseArchived,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  lessonState: 'shown' | 'hidden' | 'archived';
  courseArchived: boolean;
}) {
  const trpc = useCoreApi();
  const [open, setOpen] = useState<string>();
  const lesson = { courseId, moduleId, lessonId };
  const query = useInfiniteQuery(
    trpc.discussion.listQuestions.infiniteQueryOptions(lesson, {
      getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    }),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PagedList
        query={query}
        rows={rows}
        label="Questions"
        emptyText="No questions on this lesson yet."
        errorText="Couldn't load the questions."
        renderRow={(row) => (
          <li key={row.postId} className="space-y-2 p-4">
            <PostCard
              post={{
                ...row,
                state: row.state === 'hidden' ? 'shown' : row.state,
              }}
              showTitle
              headingLevel={2}
              action="asked"
            />
            <p className="text-xs text-muted-foreground">
              {row.state === 'hidden' ? 'Hidden · ' : ''}
              {row.replyCount === 1
                ? '1 reply'
                : `${row.replyCount ?? 0} replies`}
              {row.answered && !row.promptAnswer ? ' · Answered' : ''}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(row.threadId)}
            >
              Open thread
            </Button>
          </li>
        )}
      />
      {open ? (
        <ThreadDialog
          lesson={lesson}
          threadId={open}
          lessonState={lessonState}
          courseArchived={courseArchived}
          headingId="by-lesson-heading"
          onClose={() => setOpen(undefined)}
        />
      ) : null}
    </>
  );
}

// Pick a lesson of the course, then read and answer all of its questions.
export function ByLessonView({ courseId }: { courseId: string }) {
  const course = useCourseLessons(courseId);
  const [picked, setPicked] = useState('');

  if (course.isPending) {
    return <p className="text-sm text-muted-foreground">Loading lessons…</p>;
  }
  if (course.isError) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load the lessons"
        onRetry={() => void course.refetch()}
      >
        {apiErrorMessage(course.error, "Couldn't load the lessons.")}
      </ErrorAlert>
    );
  }
  if (!course.data) {
    return null;
  }
  const { lessons, courseArchived } = course.data;
  const lesson = lessons.find((l) => l.lessonId === picked);

  return (
    <div className="space-y-4">
      <h2 id="by-lesson-heading" tabIndex={-1} className="sr-only">
        Questions by lesson
      </h2>
      <div className="space-y-2">
        <Label htmlFor="questions-lesson">Lesson</Label>
        <select
          id="questions-lesson"
          className="block w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm"
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
        >
          <option value="">Choose a lesson</option>
          {lessons.map((l) => {
            const label = lessonStateLabel(l.state);
            return (
              <option key={l.lessonId} value={l.lessonId}>
                {l.title}
                {label ? ` (${label})` : ''}
              </option>
            );
          })}
        </select>
      </div>
      {lesson ? (
        <LessonQuestions
          key={lesson.lessonId}
          courseId={courseId}
          moduleId={lesson.moduleId}
          lessonId={lesson.lessonId}
          lessonState={lesson.state}
          courseArchived={courseArchived}
        />
      ) : null}
    </div>
  );
}
