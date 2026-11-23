/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import type { ICoursePreviewSummary } from '@discava/instructor-api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { PreviewVideoArea } from './preview-video-area';

// The limits core-table's courseLandingWrites enforces.
const MAX_ITEMS = 10;
const MAX_LENGTH = 160;

interface Item {
  // Stable across reordering, so each input keeps its own focus and text.
  id: number;
  text: string;
}

const toText = (items: Item[]) => items.map((item) => item.text);

function ItemList({
  label,
  noun,
  items,
  readOnly,
  onChange,
  nextId,
}: {
  label: string;
  noun: string;
  items: Item[];
  readOnly?: boolean;
  onChange: (items: Item[]) => void;
  nextId: () => number;
}) {
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  // Where focus goes once the change has rendered; the control that had it is
  // gone or disabled by then.
  const focusAfter = useRef<(() => HTMLElement | null | undefined) | null>(
    null,
  );
  useEffect(() => {
    const find = focusAfter.current;
    focusAfter.current = null;
    find?.()?.focus();
  });
  const inRow = (id: number, selector: string) =>
    fieldsetRef.current?.querySelector<HTMLElement>(
      `[data-item-id="${id}"] ${selector}`,
    );

  const move = (index: number, by: -1 | 1) => {
    const next = [...items];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    // Keep focus on the button just used, or on the other one when moving to an
    // end disables it.
    const id = items[index].id;
    focusAfter.current = () =>
      inRow(id, `[data-move="${by === -1 ? 'up' : 'down'}"]:not(:disabled)`) ??
      inRow(id, '[data-move]:not(:disabled)');
    onChange(next);
  };

  const remove = (index: number) => {
    const neighbour = items[index + 1] ?? items[index - 1];
    focusAfter.current = () =>
      neighbour
        ? inRow(neighbour.id, 'input')
        : fieldsetRef.current?.querySelector<HTMLElement>('[data-add]');
    onChange(items.filter((_, other) => other !== index));
  };

  return (
    <fieldset ref={fieldsetRef} className="space-y-3">
      <legend className="text-sm font-medium">{label}</legend>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No {noun} yet.</p>
      )}
      <ul className="space-y-3">
        {items.map((item, index) => (
          <li key={item.id} data-item-id={item.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-w-0 flex-1"
                aria-label={`${label} item ${index + 1}`}
                value={item.text}
                maxLength={MAX_LENGTH}
                disabled={readOnly}
                onChange={(event) =>
                  onChange(
                    items.map((other) =>
                      other.id === item.id
                        ? { ...other, text: event.target.value }
                        : other,
                    ),
                  )
                }
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {item.text.length}/{MAX_LENGTH}
              </span>
              {!readOnly && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={index === 0}
                    data-move="up"
                    aria-label={`Move up ${label} item ${index + 1}`}
                    onClick={() => move(index, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={index === items.length - 1}
                    data-move="down"
                    aria-label={`Move down ${label} item ${index + 1}`}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove ${label} item ${index + 1}`}
                    onClick={() => remove(index)}
                  >
                    Remove
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-add
            aria-label={`Add ${label} item`}
            disabled={items.length >= MAX_ITEMS}
            onClick={() => onChange([...items, { id: nextId(), text: '' }])}
          >
            Add
          </Button>
          <span className="text-xs text-muted-foreground">
            {items.length} of {MAX_ITEMS} used
          </span>
        </div>
      )}
    </fieldset>
  );
}

/**
 * What a visitor reads on the public course page: what they'll learn and what
 * they need first, and the preview video. Saving replaces both lists; the
 * preview video's upload, replace and remove act at once.
 */
export function LandingPageCard({
  courseId,
  learningOutcomes,
  requirements,
  preview,
  readOnly,
}: {
  courseId: string;
  learningOutcomes?: string[];
  requirements?: string[];
  preview?: ICoursePreviewSummary;
  readOnly?: boolean;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.course.updateLanding.mutationOptions());

  const counter = useRef(0);
  const nextId = () => {
    counter.current += 1;
    return counter.current;
  };
  const toItems = (texts: string[] = []): Item[] =>
    texts.map((text) => ({ id: nextId(), text }));

  const [outcomes, setOutcomes] = useState(() => toItems(learningOutcomes));
  const [needs, setNeeds] = useState(() => toItems(requirements));
  const [saved, setSaved] = useState(false);

  const edited = (set: (items: Item[]) => void) => (items: Item[]) => {
    set(items);
    setSaved(false);
    save.reset();
  };

  // Back to what was last saved.
  const cancel = () => {
    setOutcomes(toItems(learningOutcomes));
    setNeeds(toItems(requirements));
    setSaved(false);
    save.reset();
  };

  const handleSave = async () => {
    setSaved(false);
    try {
      // A blank line is an item the visitor would never see, so it's dropped.
      await save.mutateAsync({
        courseId,
        learningOutcomes: toText(outcomes).filter((text) => text.trim()),
        requirements: toText(needs).filter((text) => text.trim()),
      });
    } catch {
      // Shown below from the mutation's error.
      return;
    }
    setSaved(true);
    await queryClient.invalidateQueries({
      queryKey: trpc.course.view.queryKey({ courseId }),
    });
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {save.isError && (
        <ErrorAlert type="error" header="Couldn't save the landing page">
          {apiErrorMessage(save.error)}
        </ErrorAlert>
      )}
      <ItemList
        label="What students will learn"
        noun="learning outcomes"
        items={outcomes}
        readOnly={readOnly}
        onChange={edited(setOutcomes)}
        nextId={nextId}
      />
      <ItemList
        label="Requirements"
        noun="requirements"
        items={needs}
        readOnly={readOnly}
        onChange={edited(setNeeds)}
        nextId={nextId}
      />
      <PreviewVideoArea
        courseId={courseId}
        preview={preview}
        readOnly={readOnly}
      />
      {!readOnly && (
        <div className="flex items-center gap-3">
          <PendingButton
            type="submit"
            pending={save.isPending}
            pendingLabel="Saving…"
          >
            Save landing page
          </PendingButton>
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <StatusMessage message={saved ? 'Saved' : null} />
        </div>
      )}
    </form>
  );
}
