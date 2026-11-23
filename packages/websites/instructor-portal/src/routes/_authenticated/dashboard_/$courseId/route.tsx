/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BarChart3, Users } from 'lucide-react';
import { useInstructorApi } from '../../../../api';
import { ActivationCard } from './-components/activation-card';
import { DailyChart } from './-components/daily-chart';
import { LessonDropOff } from './-components/lesson-drop-off';
import { QuizPanel } from './-components/quiz-panel';
import { TotalsRow } from './-components/totals-row';
import { VideoQuestionsPanel } from './-components/video-questions-panel';

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

  const notFound =
    analyticsQuery.isError && analyticsQuery.error.data?.code === 'NOT_FOUND';
  usePageTitle(title ?? 'Course analytics', title && 'Dashboard');

  const analytics = analyticsQuery.data;

  return (
    <div className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <BarChart3 className="size-4" /> Course analytics
          </div>
          <h1 className="text-balance [overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
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
              asChild
              size="sm"
              variant={range === days ? 'default' : 'outline'}
            >
              <Link
                to="."
                search={{ days: range }}
                aria-current={range === days ? 'true' : undefined}
              >
                {range} days
              </Link>
            </Button>
          ))}
        </div>
      </section>

      {analyticsQuery.isError ? (
        <div className="space-y-3">
          <ErrorAlert
            type="error"
            header={
              notFound ? 'Course not found' : "Couldn't load the analytics"
            }
          >
            {notFound
              ? "This course doesn't exist, or you don't have access to it."
              : apiErrorMessage(analyticsQuery.error)}
          </ErrorAlert>
          {notFound ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard">Back to the dashboard</Link>
            </Button>
          ) : (
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
      ) : !analytics ? (
        <div
          className="space-y-4"
          role="status"
          aria-busy="true"
          aria-label="Loading the analytics"
        >
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
              className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
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
            <section
              aria-label="Lesson drop-off and activation"
              className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <LessonDropOff
                lessons={analytics.lessons}
                modulesWithoutQuestions={analytics.modulesWithoutQuestions}
              />
              <ActivationCard
                totals={analytics.totals}
                daily={analytics.daily}
                days={days}
              />
            </section>
          )}
          {analytics.totals.enrolments > 0 && analytics.quizzes.length > 0 && (
            <section aria-label="Quizzes" className="space-y-4">
              <h2 className="text-base font-semibold">Quizzes</h2>
              {analytics.quizzes.map((quiz) => (
                <QuizPanel
                  key={quiz.contentItemId}
                  courseId={courseId}
                  quiz={quiz}
                />
              ))}
            </section>
          )}
          {analytics.totals.enrolments > 0 && (
            <section aria-label="Video questions results">
              <VideoQuestionsPanel
                courseId={courseId}
                videos={analytics.videoQuestions}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
