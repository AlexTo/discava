/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { DISCUSSION_BODY_MAX } from '@discava/common-web-utils/discussion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useCoreApi } from '../../../../../api';
import { errorCode } from '../../../../../hooks/use-course-player';
import { usePostId } from './post-id';
import type { LessonRef } from './question-form';

// The course's first-lesson prompt, shown once to a new learner: answer it
// (a public post) or press Not now. Either closes it for good, on every
// device. When it was already closed elsewhere (PRECONDITION_FAILED) the
// enrolment is refetched and the prompt goes without an error; any other
// failure keeps what was typed.
export function FirstLessonPrompt({
  lesson,
  prompt,
}: {
  lesson: LessonRef;
  prompt: string;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const [postId] = usePostId();
  const [body, setBody] = useState('');
  const { courseId } = lesson;

  const refetchEnrolment = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.course.myEnrolment.queryKey({ courseId }),
    });

  const answer = useMutation(
    trpc.discussion.answerPrompt.mutationOptions({
      onSuccess: () => {
        queryClient.setQueryData(
          trpc.course.myEnrolment.queryKey({ courseId }),
          (enrolment) =>
            enrolment
              ? { ...enrolment, firstLessonPromptState: 'answered' as const }
              : enrolment,
        );
        void queryClient.invalidateQueries({
          queryKey: trpc.discussion.listQuestions.pathKey(),
        });
      },
      onError: (error) => {
        if (errorCode(error) === 'PRECONDITION_FAILED') {
          void refetchEnrolment();
        }
      },
    }),
  );
  const dismiss = useMutation(
    trpc.course.dismissFirstLessonPrompt.mutationOptions({
      onSuccess: (enrolment) => {
        queryClient.setQueryData(
          trpc.course.myEnrolment.queryKey({ courseId }),
          // dismiss doesn't say whether the enrolment was bought.
          (current) => ({ ...enrolment, paidFor: current?.paidFor ?? false }),
        );
      },
      onError: (error) => {
        if (errorCode(error) === 'PRECONDITION_FAILED') {
          void refetchEnrolment();
        }
      },
    }),
  );

  const failure = [answer, dismiss]
    .map((mutation) => mutation.error)
    .find((error) => error && errorCode(error) !== 'PRECONDITION_FAILED');
  const busy = answer.isPending || dismiss.isPending;
  const empty = body.trim() === '';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !busy) {
          dismiss.reset();
          answer.mutate({ ...lesson, postId, body });
        }
      }}
    >
      <fieldset className="space-y-2">
        <legend className="font-medium">{prompt}</legend>
        <Label htmlFor="first-lesson-prompt-body">Your answer</Label>
        <Textarea
          id="first-lesson-prompt-body"
          value={body}
          rows={4}
          maxLength={DISCUSSION_BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {body.length} / {DISCUSSION_BODY_MAX.toLocaleString('en-US')}
        </p>
        <p className="text-xs text-muted-foreground">
          Everyone in this course can read your answer.
        </p>
      </fieldset>
      {failure ? (
        <ErrorAlert type="error" header="Couldn't save your answer">
          {apiErrorMessage(failure)}
        </ErrorAlert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={empty || busy}>
          Post
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            answer.reset();
            dismiss.mutate({ courseId });
          }}
        >
          Not now
        </Button>
      </div>
    </form>
  );
}
