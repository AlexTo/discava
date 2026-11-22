/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BarChart3, BookOpen } from 'lucide-react';
import { useInstructorApi } from '../../../api';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../../lib/course-status';

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: RouteComponent,
});

const courseStatusLabels: Record<string, CourseStatus> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const lastUpdated = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

// The figures behind each card come from the course's analytics aggregates,
// which trail the records by a few seconds (see instructor-api's
// analytics.courseSummaries): the card says when they last changed.
function RouteComponent() {
  const trpc = useInstructorApi();
  const summariesQuery = useQuery(
    trpc.analytics.courseSummaries.queryOptions(),
  );
  const courses = summariesQuery.data ?? [];

  return (
    <main className="w-full space-y-6 pb-8">
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
          <BarChart3 className="size-4" /> Insights
        </div>
        <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          See how your courses are doing.
        </p>
      </section>

      {summariesQuery.isPending ? (
        <section
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Loading your courses"
        >
          {[0, 1, 2].map((placeholder) => (
            <Skeleton
              key={placeholder}
              data-testid="course-card-skeleton"
              className="h-44 w-full rounded-xl"
            />
          ))}
        </section>
      ) : summariesQuery.isError ? (
        <div className="space-y-3">
          <ErrorAlert type="error" header="Couldn't load your courses">
            {apiErrorMessage(summariesQuery.error)}
          </ErrorAlert>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => summariesQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : courses.length === 0 ? (
        <Card className="border-dashed py-12 text-center">
          <CardContent>
            <BookOpen className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">
              You don't teach any courses yet
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a course, and how it is doing will show here.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/my-courses">Create a course</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Your courses"
        >
          {courses.map((course) => {
            const status = courseStatusLabels[course.status] ?? 'Draft';
            return (
              <Link
                key={course.courseId}
                to="/dashboard/$courseId"
                params={{ courseId: course.courseId }}
                search={{ days: 90 }}
                className="block h-full"
              >
                <Card className="h-full gap-4 transition-shadow hover:shadow-md">
                  <CardHeader className="px-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <CardTitle
                        className="min-w-0 break-words text-base leading-5"
                        role="heading"
                        aria-level={2}
                      >
                        {course.title}
                      </CardTitle>
                      <Badge
                        className={`shrink-0 ${courseStatusStyles[status]}`}
                      >
                        {status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 px-5">
                    <dl className="grid grid-cols-3 gap-3">
                      <Figure label="Enrolments" value={course.enrolments} />
                      <Figure
                        label="Active this week"
                        value={course.activeThisWeek}
                      />
                      <Figure
                        label="Completion rate"
                        value={
                          course.completionRate === null
                            ? 'No data'
                            : `${course.completionRate}%`
                        }
                      />
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      {course.updatedAt
                        ? `Last updated ${lastUpdated.format(new Date(course.updatedAt))}`
                        : 'No activity yet'}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
