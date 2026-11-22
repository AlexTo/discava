/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCoreApi } from '../../api';
import { CatalogueResults } from '../../components/catalogue-results';
import { PageBreadcrumbs } from '../../components/page-breadcrumbs';
import { PageContainer } from '../../components/page-container';
import {
  type CatalogueFilters,
  catalogueFiltersToSearch,
  parseCatalogueFilters,
} from '../../lib/catalogue-filters';

// The category is the address, so it is never a filter here.
const parseFilters = (search: Record<string, unknown>): CatalogueFilters => ({
  ...parseCatalogueFilters(search),
  category: undefined,
});

export const Route = createFileRoute('/category/$slug')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.query === 'string' &&
      search.query !== '' && { query: search.query }),
    ...catalogueFiltersToSearch(parseFilters(search)),
  }),
  component: RouteComponent,
});

function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <div className="py-16 text-center">
      <Search className="mx-auto size-8 text-muted-foreground" />
      <h1 className="text-balance mt-4 text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button className="mt-5" variant="outline" asChild>
        <Link to="/courses" search={{}}>
          Browse all courses
        </Link>
      </Button>
    </div>
  );
}

function RouteComponent() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const query = (search.query ?? '').trim();
  const filters = parseFilters(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const [text, setText] = useState(query);
  // Keep the box in step with the address (back, or a link without a query).
  useEffect(() => setText(query), [query]);

  const trpc = useCoreApi();
  const categoryQuery = useQuery(
    trpc.category.bySlug.queryOptions(
      { slug },
      {
        // A cold start is not "not found"; only NOT_FOUND ends the lookup.
        retry: (failureCount, error) =>
          (error as { data?: { code?: string } }).data?.code !== 'NOT_FOUND' &&
          failureCount < 1,
      },
    ),
  );
  const category = categoryQuery.data;
  usePageTitle(category?.name ?? 'Category');

  const setSearch = (nextQuery: string, next: CatalogueFilters) =>
    navigate({
      search: {
        ...(nextQuery && { query: nextQuery }),
        ...catalogueFiltersToSearch(next),
      },
    });

  const notFound =
    (categoryQuery.error as { data?: { code?: string } } | null)?.data?.code ===
    'NOT_FOUND';

  return (
    <PageContainer>
      <PageBreadcrumbs
        crumbs={[{ label: category?.name ?? 'Category' }]}
        className="mb-6"
      />
      {categoryQuery.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : notFound ? (
        <Unavailable
          title="Category not found"
          message="There is no category at this address."
        />
      ) : categoryQuery.isError || !category ? (
        <ErrorAlert
          type="error"
          header="Couldn't load this category"
          onRetry={() => categoryQuery.refetch()}
        >
          <p>{apiErrorMessage(categoryQuery.error)}</p>
        </ErrorAlert>
      ) : category.status === 'archived' ? (
        <Unavailable
          title={`${category.name} is no longer available`}
          message="This category has been archived."
        />
      ) : (
        <>
          <h1 className="text-balance text-2xl font-bold tracking-tight">
            {category.name}
          </h1>
          <form
            role="search"
            className="mt-4 flex max-w-md gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(text.trim(), filters);
            }}
          >
            <Input
              type="search"
              name="query"
              autoComplete="off"
              aria-label={`Search ${category.name}`}
              placeholder={`Search ${category.name}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <Button type="submit">Search</Button>
          </form>
          <CatalogueResults
            query={query}
            filters={filters}
            fixedCategoryId={category.id}
            onFiltersChange={(next) => setSearch(query, next)}
            emptyMessage="No courses in this category match. Try fewer filters."
          />
        </>
      )}
    </PageContainer>
  );
}
