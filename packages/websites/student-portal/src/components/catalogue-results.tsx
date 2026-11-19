/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useCoreApi } from '../api';
import {
  type CatalogueFilters,
  catalogueFiltersToInput,
  hasCatalogueFilters,
  NO_FILTERS,
} from '../lib/catalogue-filters';
import { toDisplayCourse } from '../lib/course-display';
import { CatalogueFilterPanel } from './catalogue-filters';
import { CourseCard } from './course-card';

const PAGE_SIZE = 12;

// Whether `error` is the cold-start timeout course.publicSearch returns when
// the search collection has scaled to zero and hasn't woken up yet (#267):
// retriable, unlike a real failure, so it gets its own message and an
// automatic retry rather than the generic error state.
const isColdStart = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === 'TIMEOUT';

/**
 * Courses matching a text query (or none, to browse) and the filters, with
 * the filter panel beside them. Filters live in the caller's address; this
 * only reports changes.
 */
export function CatalogueResults({
  query,
  filters,
  onFiltersChange,
  emptyMessage = 'No courses match. Try fewer or different words, or clear the filters.',
  fixedCategoryId,
}: {
  query?: string;
  filters: CatalogueFilters;
  onFiltersChange: (filters: CatalogueFilters) => void;
  emptyMessage?: string;
  // A landing page's category: results stay inside it and the panel has no
  // category group.
  fixedCategoryId?: string;
}) {
  const trpc = useCoreApi();
  // A category's address names its slug; the API filters by its id.
  const categoriesQuery = useQuery({
    ...trpc.category.list.queryOptions(),
    enabled: !fixedCategoryId,
  });
  const categoryId = fixedCategoryId
    ? fixedCategoryId
    : filters.category
      ? (categoriesQuery.data?.find(({ slug }) => slug === filters.category)
          ?.id ?? filters.category)
      : undefined;

  const searchQuery = useInfiniteQuery(
    trpc.course.publicSearch.infiniteQueryOptions(
      {
        ...(query && { q: query }),
        ...catalogueFiltersToInput(filters, categoryId),
        limit: PAGE_SIZE,
      },
      {
        // Wait for the categories to resolve a slug to its id.
        enabled:
          !!fixedCategoryId || !filters.category || !categoriesQuery.isPending,
        getNextPageParam: (lastPage) => lastPage.cursor,
        // A cold collection's first request times out server-side (#267);
        // the wake it triggered keeps going, so the same query a few
        // seconds later usually lands. One retry covers that without
        // leaving a real failure spinning.
        retry: (failureCount, error) => isColdStart(error) && failureCount < 1,
        retryDelay: 3_000,
      },
    ),
  );
  const results = searchQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const facets = searchQuery.data?.pages[0]?.facets;
  const coldStart = isColdStart(searchQuery.error ?? searchQuery.failureReason);

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_1fr]">
      {facets && (
        <CatalogueFilterPanel
          facets={facets}
          filters={filters}
          onChange={onFiltersChange}
          showCategory={!fixedCategoryId}
        />
      )}
      <div className={facets ? '' : 'lg:col-span-2'}>
        {searchQuery.isLoading || searchQuery.isPending ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Spinner />
            {coldStart && (
              <p className="text-sm text-muted-foreground">
                Search is starting up. This can take a few seconds.
              </p>
            )}
          </div>
        ) : searchQuery.isError ? (
          <ErrorAlert
            type="error"
            header={
              coldStart ? 'Search is starting up' : "Couldn't search courses"
            }
          >
            <p>{apiErrorMessage(searchQuery.error)}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => searchQuery.refetch()}
            >
              Try again
            </Button>
          </ErrorAlert>
        ) : results.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
            <Search className="mx-auto size-8 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">No courses match</h3>
            <p className="mt-2 text-sm text-muted-foreground">{emptyMessage}</p>
            {hasCatalogueFilters(filters) && (
              <Button
                className="mt-5"
                type="button"
                variant="outline"
                onClick={() => onFiltersChange(NO_FILTERS)}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {results.length} {results.length === 1 ? 'course' : 'courses'}
            </p>
            <div className="mt-4 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {results.map((course) => (
                <CourseCard
                  key={course.courseId}
                  course={toDisplayCourse(course)}
                />
              ))}
            </div>
            {searchQuery.hasNextPage && (
              <div className="mt-6 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  disabled={searchQuery.isFetchingNextPage}
                  onClick={() => searchQuery.fetchNextPage()}
                >
                  {searchQuery.isFetchingNextPage
                    ? 'Loading…'
                    : 'Load more results'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
