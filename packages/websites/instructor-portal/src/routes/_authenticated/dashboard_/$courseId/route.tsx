/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, Users } from 'lucide-react';
import { useBreadcrumbLabel } from '../../../../components/AppLayout/breadcrumb-label';
import { Alert } from '../../../../components/alert';
import { useInstructorApi } from '../../../../hooks/useInstructorApi';
import { DailyChart } from './-components/daily-chart';
import { LessonDropOff } from './-components/lesson-drop-off';
import { TotalsRow } from './-components/totals-row';

type Days = 30 | 90;
const RANGES: Days[] = [30, 90];

// `dashboard_` keeps this route out of the dashboard page's layout, so it
// replaces the page rather than rendering inside it.
export const Route = createFileRoute('/_authenticated/dashboard_/$courseId')({
  // The range is kept in the URL so it survives a reload and can be shared.
  validateSearch: (search: Record<string, unknown>): { days: Days } => ({
    days: Number(search.days) === 30 ? 30 : 90,
  }),
  component: RouteComponent,
});

const lastUpdated = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

// The figures come from the course's analytics aggregates, which trail the
// records by a few seconds (see instructor-api's analytics.course), so the
// header says when they last changed.
function RouteComponent() {
  const { courseId } = Route.useParams();
  const { days } = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useInstructorApi();
  const analyticsQuery = useQuery(
    trpc.analytics.course.queryOptions({ courseId, days }),
  );
  // The title isn't in the analytics; the dashboard's summaries carry it.
  const summariesQuery = useQuery(
    trpc.analytics.courseSummaries.queryOptions(),
  );
  const title = summariesQuery.data?.find(
    (summary) => summary.courseId === courseId,
  )?.title;
  useBreadcrumbLabel(title);

  if (analyticsQuery.isError) {
    const notFound = analyticsQuery.error.data?.code === 'NOT_FOUND';
    return (
      <div className="space-y-3">
        <Alert
          type="error"
          header={notFound ? 'Course not found' : "Couldn't load the analytics"}
        >
          {notFound
            ? "This course doesn't exist, or you don't have access to it."
            : apiErrorMessage(analyticsQuery.error)}
        </Alert>
        {!notFound && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => analyticsQuery.refetch()}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  const analytics = analyticsQuery.data;

  return (
    <main className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <BarChart3 className="size-4" /> Course analytics
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {title ?? 'Course analytics'}
          </h1>
          {analytics && (
            <p className="mt-2 text-sm text-muted-foreground">
              {analytics.totals.updatedAt
                ? `Last updated ${lastUpdated.format(new Date(analytics.totals.updatedAt))}`
                : 'No activity yet'}
            </p>
          )}
        </div>
        <div role="group" aria-label="Range" className="flex gap-2">
          {RANGES.map((range) => (
            <Button
              key={range}
              type="button"
              size="sm"
              variant={range === days ? 'default' : 'outline'}
              aria-pressed={range === days}
              onClick={() => navigate({ search: { days: range } })}
            >
              {range} days
            </Button>
          ))}
        </div>
      </section>

      {!analytics ? (
        <div className="space-y-4" aria-label="Loading the analytics">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <TotalsRow totals={analytics.totals} />
          {analytics.totals.enrolments === 0 ? (
            <Card className="border-dashed py-12 text-center">
              <CardContent>
                <Users className="mx-auto size-8 text-muted-foreground" />
                <h2 className="mt-4 font-semibold">
                  No learners have enrolled yet
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enrolments and activity will chart here once they do.
                </p>
              </CardContent>
            </Card>
          ) : (
            <section
              className="grid gap-4 xl:grid-cols-2"
              aria-label="Over time"
            >
              <DailyChart
                title="New enrolments per day"
                field="enrolments"
                label="New enrolments"
                days={analytics.daily}
              />
              <DailyChart
                title="Active learners per day"
                field="activeLearners"
                label="Active learners"
                days={analytics.daily}
              />
            </section>
          )}
          {analytics.totals.enrolments > 0 && (
            <section aria-label="Lesson drop-off">
              <LessonDropOff lessons={analytics.lessons} />
            </section>
          )}
        </>
      )}
    </main>
  );
}
