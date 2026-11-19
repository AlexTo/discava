/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input } from '@discava/common-shadcn/components/ui/input';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useCoreApi } from '../api';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { SiteSearchSuggestions } from './site-search-suggestions';

const SUGGEST_DEBOUNCE_MS = 300;
const SUGGEST_MIN_LENGTH = 3;
// The suggestions input schema's bounds.
const SUGGEST_MAX_LENGTH = 200;

// The top bar's course search, on every page: typing three or more characters
// suggests matching courses after a short pause, and submitting it opens the
// results at /search?query=…. On the results page it shows the query being
// searched.
export const SiteSearch = () => {
  const trpc = useCoreApi();
  const navigate = useNavigate();
  const suggestionsId = useId();
  const currentQuery = useRouterState({
    select: (state) => {
      const { pathname, search } = state.location;
      const query = (search as { query?: unknown }).query;
      return pathname === '/search' && typeof query === 'string' ? query : '';
    },
  });
  const [value, setValue] = useState(currentQuery);
  // Suggestions wait for an edit: the results page starts with its query in
  // the box and the list closed.
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  // Set once a suggestion is chosen or the box is submitted, until the next edit.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setValue(currentQuery);
    setTouched(false);
  }, [currentQuery]);

  const typed = value.trim();
  const [debounced, cancelDebounce] = useDebouncedValue(
    typed,
    SUGGEST_DEBOUNCE_MS,
  );
  const wanted = focused && touched && !dismissed;
  // A failed or throttled request shows nothing: suggestions are a shortcut,
  // and the box still submits.
  const suggestions = useQuery(
    trpc.course.publicSuggest.queryOptions(
      { q: debounced },
      {
        enabled:
          wanted &&
          debounced.length >= SUGGEST_MIN_LENGTH &&
          debounced.length <= SUGGEST_MAX_LENGTH,
        staleTime: 60_000,
        retry: false,
        placeholderData: keepPreviousData,
      },
    ),
  );
  const items = suggestions.data?.items ?? [];
  const open =
    wanted &&
    typed.length >= SUGGEST_MIN_LENGTH &&
    (items.length > 0 || suggestions.isFetching);

  const dismiss = () => {
    cancelDebounce();
    setDismissed(true);
  };

  return (
    <form
      role="search"
      className="relative w-full max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        dismiss();
        const query = value.trim();
        if (query) {
          navigate({ to: '/search', search: { query } });
        }
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        autoComplete="off"
        aria-label="Search courses"
        placeholder="What do you want to learn?"
        className="h-10 rounded-full bg-muted/40 pl-10"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setTouched(true);
          setDismissed(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {open && (
        <SiteSearchSuggestions
          id={suggestionsId}
          items={items}
          typed={typed}
          loading={suggestions.isFetching}
          onChoose={(courseId) => {
            dismiss();
            navigate({ to: '/learn/$courseId', params: { courseId } });
          }}
        />
      )}
    </form>
  );
};
