/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';

const MIN_LENGTH = 2;
// The search procedure's input bound.
const MAX_LENGTH = 200;

// Searches what was said in a course's videos, from the course player's
// header. Nothing is requested while typing: submitting opens the results
// page, which asks the API. On the results page it shows the current query.
export function TranscriptSearchBox({
  courseId,
  query = '',
}: {
  courseId: string;
  query?: string;
}) {
  const navigate = useNavigate();
  const inputId = useId();
  const hintId = useId();
  const [value, setValue] = useState(query);
  const [tooShort, setTooShort] = useState(false);
  useEffect(() => setValue(query), [query]);

  return (
    <form
      role="search"
      aria-label="Search this course's transcripts"
      className="flex w-full flex-wrap items-center gap-2 sm:max-w-md"
      onSubmit={(event) => {
        event.preventDefault();
        const q = value.trim();
        if (q.length < MIN_LENGTH) {
          setTooShort(true);
          return;
        }
        setTooShort(false);
        navigate({
          to: '/learn/$courseId/search',
          params: { courseId },
          search: { q },
        });
      }}
    >
      <Label htmlFor={inputId} className="sr-only">
        Search transcripts
      </Label>
      <Input
        id={inputId}
        type="text"
        value={value}
        maxLength={MAX_LENGTH}
        placeholder="Search what was said"
        aria-describedby={tooShort ? hintId : undefined}
        className="min-w-0 flex-1"
        onChange={(event) => {
          setValue(event.target.value);
          setTooShort(false);
        }}
      />
      <Button type="submit" variant="outline">
        Search
      </Button>
      {tooShort ? (
        <p id={hintId} className="basis-full text-xs text-muted-foreground">
          Type at least 2 characters
        </p>
      ) : null}
    </form>
  );
}
