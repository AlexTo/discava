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
import { CouponsScreen } from './-components/coupons/coupons-screen';

// `$courseId_` keeps this route out of the course page's layout, so it
// replaces the page rather than rendering inside it.
export const Route = createFileRoute(
  '/_authenticated/my-courses_/$courseId_/coupons',
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
  usePageTitle('Coupons', courseQuery.data?.title);

  return (
    <div className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance break-words [overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
            Coupons
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Discount codes students enter at checkout to pay less for this
            course.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/my-courses/$courseId" params={{ courseId }}>
            Back to course
          </Link>
        </Button>
      </section>
      <CouponsScreen courseId={courseId} />
    </div>
  );
}
