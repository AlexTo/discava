/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useInstructorApi } from '../../../../api';
import { ReviewsScreen } from './-components/reviews-screen';

// `$courseId_` keeps this route out of the course page's layout, so it
// replaces the page rather than rendering inside it.
export const Route = createFileRoute(
  '/_authenticated/my-courses_/$courseId_/reviews',
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  // Shares the course editor's cached answer.
  const courseQuery = useQuery(
    useInstructorApi().course.view.queryOptions({ courseId }),
  );
  useBreadcrumbLabel(courseQuery.data?.title, `/my-courses/${courseId}`);
  usePageTitle('Reviews', courseQuery.data?.title);

  return (
    <div className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance break-words [overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
            Course reviews
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            What students think of this course. Respond to a review to answer it
            publicly.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/my-courses/$courseId" params={{ courseId }}>
            Back to course
          </Link>
        </Button>
      </section>
      <ReviewsScreen courseId={courseId} />
    </div>
  );
}
