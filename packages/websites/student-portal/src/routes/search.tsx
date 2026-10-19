/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { Alert } from '../components/alert';
import { Spinner } from '../components/spinner';
import { useCoreApi } from '../hooks/useCoreApi';

// What the top bar's search finds: published courses whose title or
// description contain every word searched for, in any order and case.
// Filtered in the browser from the first 100 published courses, the same list
// the catalogue shows, until there's search on the server (#53).
export const matchesQuery = (
  course: { title: string; description?: string },
  query: string,
) => {
  const text = `${course.title} ${course.description ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
};

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): { query?: string } =>
    typeof search.query === 'string' ? { query: search.query } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const query = (Route.useSearch().query ?? '').trim();
  const trpc = useCoreApi();
  const coursesQuery = useQuery(
    trpc.course.publicList.queryOptions({ limit: 100 }, { enabled: !!query }),
  );
  const results = (coursesQuery.data?.items ?? []).filter((course) =>
    matchesQuery(course, query),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10 lg:px-8">
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
          {coursesQuery.isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : coursesQuery.isError ? (
            <div className="mt-6">
              <Alert type="error" header="Couldn't search courses">
                {coursesQuery.error.message}
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
            </>
          )}
        </>
      )}
    </main>
  );
}
