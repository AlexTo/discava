/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import {
  DISCUSSION_BODY_MAX,
  DISCUSSION_TITLE_MAX,
} from '@discava/common-web-utils/discussion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../../../../components/alert';
import { useCoreApi } from '../../../../../hooks/useCoreApi';
import { usePostId } from './post-id';

export interface LessonRef {
  courseId: string;
  moduleId: string;
  lessonId: string;
}

// Ask a question about the lesson. An error keeps what was typed.
export function QuestionForm({ lesson }: { lesson: LessonRef }) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const [postId, renewPostId] = usePostId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const ask = useMutation(
    trpc.discussion.ask.mutationOptions({
      onSuccess: () => {
        setTitle('');
        setBody('');
        renewPostId();
        void queryClient.invalidateQueries({
          queryKey: trpc.discussion.listQuestions.pathKey(),
        });
      },
    }),
  );
  const empty = title.trim() === '' || body.trim() === '';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !ask.isPending) {
          ask.mutate({ ...lesson, postId, title, body });
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="question-title">Question title</Label>
        <Input
          id="question-title"
          value={title}
          maxLength={DISCUSSION_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {title.length} / {DISCUSSION_TITLE_MAX}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="question-body">Details</Label>
        <Textarea
          id="question-body"
          value={body}
          rows={4}
          maxLength={DISCUSSION_BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {body.length} / {DISCUSSION_BODY_MAX.toLocaleString('en-US')}
        </p>
      </div>
      {ask.isError ? (
        <Alert type="error" header="Couldn't post your question">
          {apiErrorMessage(ask.error)}
        </Alert>
      ) : null}
      <Button type="submit" disabled={empty || ask.isPending}>
        Post question
      </Button>
    </form>
  );
}
