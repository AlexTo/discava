/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { PostCard } from '@discava/common-shadcn/discussion/post-card';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../../../../components/alert';
import { useCoreApi } from '../../../../../hooks/useCoreApi';
import { QuestionForm } from './question-form';
import { ThreadView } from './thread-view';

// The lesson page's Questions card: the lesson's questions newest first, the
// ask form, and a question's thread when one is opened. An archived course is
// read-only. A failing list shows its own error and leaves the rest of the
// page alone.
export function QuestionsSection({
  courseId,
  moduleId,
  lessonId,
  readOnly,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  readOnly: boolean;
}) {
  const trpc = useCoreApi();
  const lesson = { courseId, moduleId, lessonId };
  const [openThreadId, setOpenThreadId] = useState<string>();
  const listQuery = useInfiniteQuery(
    trpc.discussion.listQuestions.infiniteQueryOptions(lesson, {
      getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    }),
  );

  const questions = listQuery.data?.pages.flatMap((page) => page.items) ?? [];

  let content;
  if (openThreadId) {
    content = (
      <ThreadView
        lesson={lesson}
        threadId={openThreadId}
        readOnly={readOnly}
        onBack={() => setOpenThreadId(undefined)}
      />
    );
  } else if (listQuery.isPending) {
    content = (
      <div className="space-y-3" role="status" aria-label="Loading questions">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  } else if (listQuery.isError) {
    content = (
      <Alert type="error" header="Couldn't load the questions">
        {apiErrorMessage(listQuery.error)}
        <Button
          className="mt-2"
          size="sm"
          variant="outline"
          onClick={() => listQuery.refetch()}
        >
          Try again
        </Button>
      </Alert>
    );
  } else {
    content = (
      <>
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No questions yet.{readOnly ? '' : ' Ask the first one.'}
          </p>
        ) : (
          <ul className="divide-y">
            {questions.map((question) => (
              <li key={question.postId} className="py-3">
                {question.state === 'shown' ? (
                  <div className="space-y-2">
                    <PostCard post={question} showTitle action="asked">
                      <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>
                          {question.replyCount ?? 0}{' '}
                          {question.replyCount === 1 ? 'reply' : 'replies'}
                        </span>
                        {question.accepted ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-300">
                            Answered
                          </span>
                        ) : null}
                      </p>
                    </PostCard>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenThreadId(question.threadId)}
                    >
                      Open question
                    </Button>
                  </div>
                ) : (
                  <PostCard post={question} />
                )}
              </li>
            ))}
          </ul>
        )}
        {listQuery.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={listQuery.isFetchingNextPage}
              onClick={() => listQuery.fetchNextPage()}
            >
              {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-labelledby="questions-heading"
      className="space-y-4 rounded-lg border p-4"
    >
      <h3 id="questions-heading" className="text-lg font-semibold">
        Questions
      </h3>
      {readOnly ? (
        <p className="text-sm text-muted-foreground">
          This course is archived, so questions are read-only.
        </p>
      ) : null}
      {content}
      {!readOnly && !openThreadId && !listQuery.isError ? (
        <QuestionForm lesson={lesson} />
      ) : null}
    </section>
  );
}
