/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useInstructorApi } from '../../../../../../../api';
import { SubmissionsTable } from './-components/submissions-table';

// `$courseId_` keeps this route out of the course page's layout.
export const Route = createFileRoute(
  '/_authenticated/my-courses_/$courseId_/assignments/$contentItemId/submissions/',
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId, contentItemId } = Route.useParams();
  const trpc = useInstructorApi();
  const query = useInfiniteQuery(
    trpc.assignmentSubmission.list.infiniteQueryOptions(
      { courseId, contentItemId },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  );
  const first = query.data?.pages[0];
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  useBreadcrumbLabel('Course', `/my-courses/${courseId}`);
  usePageTitle(first?.assignment.title, 'Submissions');
  useBreadcrumbLabel(
    first?.assignment.title,
    `/my-courses/${courseId}/assignments/${contentItemId}`,
  );

  return (
    <div className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance break-words [overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
            {first?.assignment.title ?? 'Submissions'}
          </h1>
          {first ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Out of {first.assignment.maxPoints} points
              {first.assignment.dueAt
                ? ` · Due ${new Date(first.assignment.dueAt).toLocaleString()}`
                : ''}
            </p>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/my-courses/$courseId" params={{ courseId }}>
            Back to course
          </Link>
        </Button>
      </section>
      {first ? (
        <ul className="flex flex-wrap gap-2" aria-label="Submission counts">
          <li>
            <Badge variant="secondary">Waiting {first.counts.waiting}</Badge>
          </li>
          <li>
            <Badge variant="secondary">
              Resubmission requested {first.counts.resubmissionRequested}
            </Badge>
          </li>
          <li>
            <Badge variant="secondary">Returned {first.counts.returned}</Badge>
          </li>
          <li>
            <Badge variant="secondary">
              Not submitted {first.counts.notSubmitted}
            </Badge>
          </li>
        </ul>
      ) : null}
      <SubmissionsTable
        courseId={courseId}
        contentItemId={contentItemId}
        rows={rows}
        query={query}
      />
    </div>
  );
}
