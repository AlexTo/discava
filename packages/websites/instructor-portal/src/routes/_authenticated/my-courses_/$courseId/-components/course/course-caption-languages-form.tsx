/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Checkbox } from '@discava/common-shadcn/components/ui/checkbox';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

/**
 * The languages every video of the course is translated into. Ticked ones are
 * kept in the order they were ticked, after those already saved. Saving
 * touches no video: translation follows from the course changing.
 */
export function CourseCaptionLanguagesForm({
  courseId,
  readOnly,
}: {
  courseId: string;
  readOnly?: boolean;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const queryOptions = trpc.course.captionLanguages.queryOptions({ courseId });
  const current = useQuery(queryOptions);
  const save = useMutation(
    trpc.course.updateCaptionLanguages.mutationOptions(),
  );

  // The ticked languages once the instructor changes them; until then, what
  // is saved.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const retry = useMutation(
    trpc.course.retryCaptionTranslations.mutationOptions(),
  );

  if (current.isError) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load the caption languages"
        onRetry={() => void current.refetch()}
      >
        {apiErrorMessage(current.error)}
      </ErrorAlert>
    );
  }
  if (!current.data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const {
    languages: savedLanguages,
    supported,
    enabled,
    maxLanguages,
  } = current.data;
  const selected = draft ?? savedLanguages;
  const locked = readOnly || !enabled;
  const atLimit = selected.length >= maxLanguages;
  const removed = savedLanguages.filter((tag) => !selected.includes(tag));

  const toggle = (tag: string, checked: boolean) => {
    setDraft(
      checked ? [...selected, tag] : selected.filter((other) => other !== tag),
    );
    setSaved(false);
    save.reset();
  };

  const handleSave = async () => {
    setSaved(false);
    try {
      await save.mutateAsync({ courseId, languages: selected });
    } catch {
      // Shown below from the mutation's error.
      return;
    }
    setDraft(null);
    setSaved(true);
    await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Captions are translated automatically into the languages you choose.
        Your own uploaded captions always take precedence.
      </p>
      {!enabled && (
        <p className="text-sm text-muted-foreground">
          Caption translation isn't available on this site.
        </p>
      )}
      {save.isError && (
        <ErrorAlert type="error" header="Couldn't save the caption languages">
          {apiErrorMessage(save.error)}
        </ErrorAlert>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {supported.map(({ tag, label, nativeLabel }) => {
          const checked = selected.includes(tag);
          return (
            <li key={tag} className="flex items-center">
              <Checkbox
                id={`caption-language-${tag}`}
                checked={checked}
                disabled={locked || (!checked && atLimit)}
                onCheckedChange={(value) => toggle(tag, value === true)}
              />
              <Label
                htmlFor={`caption-language-${tag}`}
                className="min-w-0 flex-1 break-words py-1.5 pl-2"
              >
                {label} ({nativeLabel})
              </Label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {selected.length} of {maxLanguages}
      </p>
      {removed.length > 0 && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          Translated {removed.map((tag) => labelOf(supported, tag)).join(', ')}{' '}
          captions will be removed from every video. Captions you uploaded stay.
        </p>
      )}
      {retry.isError && (
        <ErrorAlert type="error" header="Couldn't ask for the translations">
          {apiErrorMessage(retry.error)}
        </ErrorAlert>
      )}
      {!locked && (
        <div className="flex items-center gap-3">
          <PendingButton
            type="submit"
            pending={save.isPending}
            pendingLabel="Saving…"
            disabled={draft === null}
          >
            Save
          </PendingButton>
          <StatusMessage message={saved ? 'Saved' : null} />
        </div>
      )}
      {!readOnly && enabled && savedLanguages.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ courseId })}
          >
            {retry.isPending ? 'Asking…' : 'Translate missing captions again'}
          </Button>
          {retry.data && (
            <span role="status" className="text-sm text-muted-foreground">
              Asked {retry.data.requested}{' '}
              {retry.data.requested === 1 ? 'video' : 'videos'}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

const labelOf = (supported: { tag: string; label: string }[], tag: string) =>
  supported.find((language) => language.tag === tag)?.label ?? tag;
