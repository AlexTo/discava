/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { useReportUnsavedChanges } from './unsaved-changes-context';

// The most the API accepts (core-table's FIRST_LESSON_PROMPT_MAX).
const PROMPT_MAX = 200;

/**
 * The question new learners are asked in the first lesson's Questions. It
 * shows the course's own text, or is empty with the default as its
 * placeholder; a failed save keeps what was typed.
 */
export function CourseFirstLessonPromptForm({
  courseId,
  firstLessonPrompt,
  defaultFirstLessonPrompt,
}: {
  courseId: string;
  firstLessonPrompt?: string;
  defaultFirstLessonPrompt: string;
}) {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  const [text, setText] = useState(firstLessonPrompt ?? '');
  const [saved, setSaved] = useState(false);
  const { mutateAsync, reset, isPending, isError, error } = useMutation(
    course.setFirstLessonPrompt.mutationOptions(),
  );

  const unchanged = text.trim() === (firstLessonPrompt ?? '');
  useReportUnsavedChanges('first-lesson-prompt', !unchanged);

  // The text to store, or null to go back to the default.
  const save = async (prompt: string | null) => {
    reset();
    setSaved(false);
    try {
      await mutateAsync({ courseId, prompt });
    } catch {
      // Surfaced via the error below; what was typed stays, to send again.
      return;
    }
    setText(prompt ?? '');
    setSaved(true);
    await queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
  };

  const fieldId = `first-lesson-prompt-${courseId}`;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (unchanged) return;
        void save(text.trim() === '' ? null : text.trim());
      }}
    >
      <div>
        <h2
          id="first-lesson-prompt"
          tabIndex={-1}
          className="scroll-mt-20 text-xl font-semibold"
        >
          First-lesson prompt
        </h2>
        <p id={`${fieldId}-help`} className="text-xs text-muted-foreground">
          New learners see this in the first lesson's Questions, once. Ask about
          the course's content, not about themselves.
        </p>
      </div>
      {isError && (
        <ErrorAlert type="error" header="Couldn't save the prompt">
          {apiErrorMessage(error)}
        </ErrorAlert>
      )}
      <div className="space-y-2">
        <Label htmlFor={fieldId}>Prompt</Label>
        <Textarea
          id={fieldId}
          value={text}
          placeholder={defaultFirstLessonPrompt}
          maxLength={PROMPT_MAX}
          rows={3}
          disabled={isPending}
          aria-describedby={`${fieldId}-help ${fieldId}-count`}
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
          }}
        />
        <p id={`${fieldId}-count`} className="text-xs text-muted-foreground">
          {[...text].length} / {PROMPT_MAX}
        </p>
      </div>
      {firstLessonPrompt === undefined && (
        <p className="text-sm text-muted-foreground">
          Using the default prompt.
        </p>
      )}
      <div className="flex items-center gap-3">
        <PendingButton
          type="submit"
          pending={isPending}
          pendingLabel="Saving…"
          aria-disabled={unchanged || undefined}
          className={unchanged ? 'cursor-not-allowed opacity-50' : undefined}
        >
          Save prompt
        </PendingButton>
        {firstLessonPrompt !== undefined && (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => void save(null)}
          >
            Use default
          </Button>
        )}
        <StatusMessage message={saved ? 'Saved' : null} />
      </div>
    </form>
  );
}
