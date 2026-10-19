/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input } from '@discava/common-shadcn/components/ui/input';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

// The top bar's course search, on every page: submitting it opens the results
// at /search?query=…. On the results page it shows the query being searched.
export const SiteSearch = () => {
  const navigate = useNavigate();
  const currentQuery = useRouterState({
    select: (state) => {
      const { pathname, search } = state.location;
      const query = (search as { query?: unknown }).query;
      return pathname === '/search' && typeof query === 'string' ? query : '';
    },
  });
  const [value, setValue] = useState(currentQuery);
  useEffect(() => setValue(currentQuery), [currentQuery]);

  return (
    <form
      role="search"
      className="relative w-full max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query) {
          navigate({ to: '/search', search: { query } });
        }
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search courses"
        placeholder="What do you want to learn?"
        className="h-10 rounded-full bg-muted/40 pl-10"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
};
