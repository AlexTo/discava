/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  QuizCard,
  type QuizSubmitResult,
} from '@discava/common-shadcn/components/quiz-card';
import type { QuizAnswers } from '@discava/common-web-utils/quiz';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from 'react-oidc-context';
import { Alert } from '../../../../components/alert';
import { Spinner } from '../../../../components/spinner';
import { useCoreApi } from '../../../../hooks/useCoreApi';
import {
  awaitProgressRecalculation,
  errorCode,
  type PlayerItem,
} from './use-course-player';

const refOf = ({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
}: PlayerItem) => ({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
});

// The student's summary and latest attempt: the card shows the latest result
// and the step bar reads the summary, so one attempt is enough.
const attemptsInput = (item: PlayerItem) => ({ ...refOf(item), limit: 1 });

/**
 * Whether the student finished a quiz without passing it (it completed
 * because no attempts remain), from what the quiz card already loaded.
 * Doesn't fetch on its own: the step bar shows ✓ until the card has loaded.
 */
export function useQuizFailed(item: PlayerItem): boolean {
  const trpc = useCoreApi();
  const { data } = useQuery(
    trpc.quiz.myAttempts.queryOptions(attemptsInput(item), { enabled: false }),
  );
  return Boolean(data?.summary && !data.summary.passedAt);
}

// A quiz in a lesson: the shared quiz card, graded by core-api. Passing it,
// or using its last attempt, completes it on the server, in the same
// transaction as the attempt.
export function QuizItem({
  item,
  readOnly,
}: {
  item: PlayerItem;
  readOnly: boolean;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const studentId = useAuth().user?.profile.sub ?? 'anonymous';
  const ref = refOf(item);
  const quizQuery = useQuery(trpc.quiz.view.queryOptions(ref));
  const attemptsQuery = useQuery(
    trpc.quiz.myAttempts.queryOptions(attemptsInput(item)),
  );
  const submitAttempt = useMutation(trpc.quiz.submitAttempt.mutationOptions());

  const invalidate = (queryKey: readonly unknown[]) =>
    void queryClient.invalidateQueries({ queryKey });

  const onSubmit = async (
    answers: QuizAnswers,
    questionsHash: string,
  ): Promise<QuizSubmitResult> => {
    try {
      const result = await submitAttempt.mutateAsync({
        ...ref,
        answers,
        questionsHash,
      });
      queryClient.setQueryData(
        trpc.quiz.myAttempts.queryKey(attemptsInput(item)),
        {
          summary: result.summary,
          attempts: { items: [result.attempt], cursor: null },
          reveal: result.reveal,
        },
      );
      // A passing or final attempt also completed the quiz; progress follows
      // once recalculation has run, which the player waits for (#237).
      invalidate(
        trpc.course.myItemCompletions.queryKey({ courseId: item.courseId }),
      );
      const { summary } = result;
      if (
        result.attempt.passed ||
        (summary.attemptsAllowed !== null &&
          summary.attemptsUsed >= summary.attemptsAllowed)
      ) {
        awaitProgressRecalculation(queryClient, trpc, item.courseId);
      }
      return { status: 'submitted', ...result };
    } catch (error) {
      const message = (error as Error).message;
      switch (errorCode(error)) {
        case 'CONFLICT':
          // The questions changed: nothing was recorded. The card carries
          // the answers over once the new questions arrive.
          await quizQuery.refetch();
          return { status: 'updated' };
        case 'NOT_FOUND':
          invalidate(trpc.course.view.queryKey({ courseId: item.courseId }));
          return {
            status: 'error',
            message: 'This quiz is no longer available.',
            closed: true,
          };
        case 'PRECONDITION_FAILED':
          // No attempts left, or the course was archived meanwhile.
          void attemptsQuery.refetch();
          invalidate(trpc.course.view.queryKey({ courseId: item.courseId }));
          return { status: 'error', message, closed: true };
        default:
          return { status: 'error', message };
      }
    }
  };

  if (quizQuery.isPending || attemptsQuery.isPending) {
    return (
      <div className="flex justify-center rounded-xl border py-10">
        <Spinner />
      </div>
    );
  }
  if (quizQuery.isError || attemptsQuery.isError) {
    return (
      <Alert type="error" header="Couldn't load this quiz">
        {(quizQuery.error ?? attemptsQuery.error)?.message}
      </Alert>
    );
  }

  const quiz = quizQuery.data;
  const attempts = attemptsQuery.data;
  return (
    <QuizCard
      quiz={quiz}
      summary={attempts.summary}
      lastAttempt={attempts.attempts.items[0] ?? null}
      reveal={attempts.reveal}
      quizKey={`${studentId}:${item.contentItemId}`}
      onSubmit={onSubmit}
      onReview={() => void quizQuery.refetch()}
      closedReason={
        readOnly
          ? 'This course is archived, so its quizzes are closed.'
          : undefined
      }
    />
  );
}
