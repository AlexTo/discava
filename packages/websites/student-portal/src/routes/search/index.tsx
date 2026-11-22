/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { CatalogueResults } from '../../components/catalogue-results';
import { PageBreadcrumbs } from '../../components/page-breadcrumbs';
import {
  type CatalogueFilters,
  catalogueFiltersToSearch,
  hasCatalogueFilters,
  parseCatalogueFilters,
} from '../../lib/catalogue-filters';

// A long query is cut so the title stays readable.
const shortQuery = (query: string) =>
  query.length > 60 ? `${query.slice(0, 60)}…` : query;

export const Route = createFileRoute('/search/')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.query === 'string' && { query: search.query }),
    ...catalogueFiltersToSearch(parseCatalogueFilters(search)),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const query = (search.query ?? '').trim();
  const filters = parseCatalogueFilters(search);
  const navigate = useNavigate({ from: Route.fullPath });
  usePageTitle(query ? `Search: ${shortQuery(query)}` : 'Search');

  // The filters live in the address, beside the text.
  const setFilters = (next: CatalogueFilters) =>
    navigate({
      search: {
        ...(query && { query }),
        ...catalogueFiltersToSearch(next),
      },
    });

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8">
      <PageBreadcrumbs crumbs={[{ label: 'Search' }]} className="mb-6" />
      {!query && !hasCatalogueFilters(filters) ? (
        <div className="py-16 text-center">
          <Search className="mx-auto size-8 text-muted-foreground" />
          <h1 className="text-balance mt-4 text-xl font-semibold">
            Search for a course
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Type what you want to learn in the search box above.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-balance break-words text-2xl font-bold tracking-tight">
            {query ? <>Results for &ldquo;{query}&rdquo;</> : 'Browse courses'}
          </h1>
          <CatalogueResults
            query={query}
            filters={filters}
            onFiltersChange={setFilters}
            emptyMessage="No courses match your search. Try fewer or different words."
          />
        </>
      )}
    </main>
  );
}
