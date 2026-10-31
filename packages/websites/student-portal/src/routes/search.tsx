/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { Alert } from '../components/alert';
import { PageBreadcrumbs } from '../components/page-breadcrumbs';
import { Spinner } from '../components/spinner';
import { useCoreApi } from '../hooks/useCoreApi';

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): { query?: string } =>
    typeof search.query === 'string' ? { query: search.query } : {},
  component: RouteComponent,
});

// Whether `error` is the cold-start timeout course.publicSearch returns when
// the search collection has scaled to zero and hasn't woken up yet (#267):
// retriable, unlike a real failure, so it gets its own message and an
// automatic retry rather than the generic error state below.
const isColdStart = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === 'TIMEOUT';

function RouteComponent() {
  const query = (Route.useSearch().query ?? '').trim();
  const trpc = useCoreApi();
  const searchQuery = useInfiniteQuery(
    trpc.course.publicSearch.infiniteQueryOptions(
      { q: query },
      {
        enabled: !!query,
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
  const coldStart = isColdStart(searchQuery.error ?? searchQuery.failureReason);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 lg:px-8">
      <PageBreadcrumbs crumbs={[{ label: 'Search' }]} className="mb-6" />
      {!query ? (
        <div className="py-16 text-center">
          <Search className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">Search for a course</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Type what you want to learn in the search box above.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">
            Results for &ldquo;{query}&rdquo;
          </h1>
          {searchQuery.isLoading ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Spinner />
              {coldStart && (
                <p className="text-sm text-muted-foreground">
                  Search is starting up. This can take a few seconds.
                </p>
              )}
            </div>
          ) : searchQuery.isError ? (
            <div className="mt-6">
              <Alert
                type="error"
                header={
                  coldStart
                    ? 'Search is starting up'
                    : "Couldn't search courses"
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
              </Alert>
            </div>
          ) : results.length === 0 ? (
            <p className="mt-4 text-muted-foreground">
              No courses match your search. Try fewer or different words.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {results.length} {results.length === 1 ? 'course' : 'courses'}
              </p>
              <ul className="mt-6 space-y-3">
                {results.map((course) => (
                  <li key={course.courseId}>
                    <Link
                      to="/learn/$courseId"
                      params={{ courseId: course.courseId }}
                      className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Card className="py-0 transition-colors hover:bg-muted/40">
                        <CardContent className="px-5 py-4">
                          <h2 className="font-semibold">{course.title}</h2>
                          {course.description ? (
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {course.description}
                            </p>
                          ) : null}
                        </CardContent>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
              {searchQuery.hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={searchQuery.isFetchingNextPage}
                    onClick={() => searchQuery.fetchNextPage()}
                  >
                    {searchQuery.isFetchingNextPage
                      ? 'Loading...'
                      : 'Load more results'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
