/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { useReportUnsavedChanges } from './unsaved-changes-context';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50';

const MAX_TAGS = 8;
const TAG_MAX_LENGTH = 30;

const LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

// The fixed list core-table's LANGUAGES holds, with names to show.
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
];

// The same normal form the API stores: trimmed, inner spaces collapsed, lower
// case. The API stays the judge of what's valid.
const normaliseTag = (tag: string) =>
  tag.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Where the course sits in the catalogue: category, tags, level, language and
 * duration. Saving replaces all five, so clearing a field clears it on the
 * course.
 */
export function CourseCatalogueForm({
  courseId,
  category: savedCategory,
  tags: savedTags,
  level,
  language,
  durationHours,
  readOnly,
}: {
  courseId: string;
  /** The course's current category, archived or not. */
  category?: { id: string; name: string; archived: boolean };
  tags?: string[];
  level?: string;
  language?: string;
  durationHours?: number;
  readOnly?: boolean;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const categories = useQuery(trpc.category.listActive.queryOptions());
  const save = useMutation(trpc.course.updateCatalogue.mutationOptions());

  const [category, setCategory] = useState(savedCategory?.id ?? '');
  const [tags, setTags] = useState(savedTags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [tagMessage, setTagMessage] = useState<string>();
  const [levelValue, setLevelValue] = useState(level ?? '');
  const [languageValue, setLanguageValue] = useState(language ?? '');
  const [duration, setDuration] = useState(durationHours?.toString() ?? '');
  const [saved, setSaved] = useState(false);

  useReportUnsavedChanges(
    'catalogue',
    !readOnly &&
      (category !== (savedCategory?.id ?? '') ||
        JSON.stringify(tags) !== JSON.stringify(savedTags ?? []) ||
        tagInput.trim() !== '' ||
        levelValue !== (level ?? '') ||
        languageValue !== (language ?? '') ||
        duration !== (durationHours?.toString() ?? '')),
  );

  const options = categories.data ?? [];
  // A course can stay in a category that has since been archived: it isn't in
  // the active list, so it's added to the picker.
  const archivedCurrent = savedCategory?.archived ? savedCategory : undefined;

  const edited = () => {
    setSaved(false);
    save.reset();
  };

  const addTag = (raw: string) => {
    const tag = normaliseTag(raw);
    if (!tag) {
      return true;
    }
    if (tag.length > TAG_MAX_LENGTH) {
      setTagMessage(`A tag is at most ${TAG_MAX_LENGTH} characters`);
      return false;
    }
    if (!tags.includes(tag)) {
      if (tags.length >= MAX_TAGS) {
        setTagMessage(`A course has at most ${MAX_TAGS} tags`);
        return false;
      }
      setTags([...tags, tag]);
    }
    setTagMessage(undefined);
    edited();
    return true;
  };

  const onTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      if (addTag(tagInput)) {
        setTagInput('');
      }
    }
  };

  const handleSave = async () => {
    // A tag still being typed is part of what's saved.
    let finalTags = tags;
    const pending = normaliseTag(tagInput);
    if (pending && !tags.includes(pending)) {
      if (tags.length >= MAX_TAGS || pending.length > TAG_MAX_LENGTH) {
        addTag(tagInput);
        return;
      }
      finalTags = [...tags, pending];
      setTags(finalTags);
    }
    setTagInput('');
    setSaved(false);
    try {
      await save.mutateAsync({
        courseId,
        categoryId: category || undefined,
        tags: finalTags,
        level: (levelValue || undefined) as never,
        language: (languageValue || undefined) as never,
        durationHours: duration === '' ? undefined : Number(duration),
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
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {save.isError && (
        <ErrorAlert type="error" header="Couldn't save the catalogue details">
          {apiErrorMessage(save.error)}
        </ErrorAlert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="catalogue-category">Category</Label>
          <select
            id="catalogue-category"
            className={SELECT_CLASS}
            value={category}
            disabled={readOnly}
            onChange={(event) => {
              setCategory(event.target.value);
              edited();
            }}
          >
            <option value="">No category</option>
            {archivedCurrent && (
              <option value={archivedCurrent.id}>
                {archivedCurrent.name} (archived)
              </option>
            )}
            {options.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {categories.isError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't load the categories.{' '}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => void categories.refetch()}
              >
                Try again
              </Button>
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="catalogue-level">Level</Label>
          <select
            id="catalogue-level"
            className={SELECT_CLASS}
            value={levelValue}
            disabled={readOnly}
            onChange={(event) => {
              setLevelValue(event.target.value);
              edited();
            }}
          >
            <option value="">Not set</option>
            {LEVELS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="catalogue-language">Language</Label>
          <select
            id="catalogue-language"
            className={SELECT_CLASS}
            value={languageValue}
            disabled={readOnly}
            onChange={(event) => {
              setLanguageValue(event.target.value);
              edited();
            }}
          >
            <option value="">Not set</option>
            {LANGUAGES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="catalogue-duration">Duration (hours)</Label>
          <Input
            id="catalogue-duration"
            type="number"
            min={1}
            max={500}
            step={1}
            value={duration}
            disabled={readOnly}
            onChange={(event) => {
              setDuration(event.target.value);
              edited();
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="catalogue-tags">Tags</Label>
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag, index) => (
              <li key={tag}>
                <Badge variant="secondary" className="gap-1.5">
                  {tag}
                  {!readOnly && (
                    <button
                      type="button"
                      className="inline-flex min-h-6 items-center text-xs underline"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => {
                        // Focus the next tag's Remove, else the previous one's,
                        // else the tag input.
                        const neighbour = tags[index + 1] ?? tags[index - 1];
                        setTags(tags.filter((other) => other !== tag));
                        setTagMessage(undefined);
                        edited();
                        setTimeout(() => {
                          const target =
                            neighbour === undefined
                              ? document.getElementById('catalogue-tags')
                              : document.querySelector<HTMLElement>(
                                  `[aria-label="Remove tag ${CSS.escape(neighbour)}"]`,
                                );
                          target?.focus();
                        });
                      }}
                    >
                      Remove
                    </button>
                  )}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <Input
          id="catalogue-tags"
          value={tagInput}
          disabled={readOnly}
          aria-describedby="catalogue-tags-help"
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={onTagKeyDown}
        />
        <p
          id="catalogue-tags-help"
          className="text-xs text-muted-foreground"
          aria-live="polite"
        >
          {tagMessage ??
            `Press Enter or comma to add a tag. Up to ${MAX_TAGS} tags (${tags.length} used).`}
        </p>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <PendingButton
            type="submit"
            pending={save.isPending}
            pendingLabel="Saving…"
          >
            Save catalogue details
          </PendingButton>
          <StatusMessage message={saved ? 'Saved' : null} />
        </div>
      )}
    </form>
  );
}
