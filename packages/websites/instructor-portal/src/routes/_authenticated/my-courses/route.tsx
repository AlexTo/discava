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
  CardDescription,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@discava/common-shadcn/components/ui/toggle-group';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, CirclePlus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useCoreApi, useInstructorApi } from '../../../api';
import { CreateCourseDialog } from '../../../components/create-course-dialog';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../../lib/course-status';

export const Route = createFileRoute('/_authenticated/my-courses')({
  component: RouteComponent,
});

const courseSurface =
  'from-emerald-500/25 to-teal-500/10 text-emerald-700 dark:text-emerald-300';

const updatedFormat = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

const courseStatusLabels: Record<string, CourseStatus> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const filters = ['All', 'Published', 'Draft', 'Archived'] as const;
type CourseFilter = (typeof filters)[number];

function RouteComponent() {
  const [filter, setFilter] = useState<CourseFilter>('All');
  const [query, setQuery] = useState('');
  const normalisedQuery = query.trim().toLocaleLowerCase();

  const auth = useAuth();
  const instructorId = auth.user?.profile.sub;
  const trpc = useCoreApi();
  const instructorTrpc = useInstructorApi();
  const publicMediaUrl = usePublicMediaUrl();
  const coursesQuery = useQuery(
    trpc.course.listByInstructor.queryOptions(
      { instructorId: instructorId ?? '', limit: 100 },
      { enabled: Boolean(instructorId) },
    ),
  );

  // Enrolments come from the dashboard's analytics aggregates; until they
  // load (or if they fail) the figure is shown as unavailable, not as zero.
  const summariesQuery = useQuery(
    instructorTrpc.analytics.courseSummaries.queryOptions(),
  );
  const enrolmentsByCourse = new Map(
    (summariesQuery.data ?? []).map((summary) => [
      summary.courseId,
      summary.enrolments,
    ]),
  );

  const courses = (coursesQuery.data?.items ?? []).map((course) => ({
    courseId: course.courseId,
    title: course.title,
    description: course.description,
    imageUrl: publicMediaUrl(course.imageKey),
    status: courseStatusLabels[course.status] ?? 'Draft',
    enrolments: enrolmentsByCourse.get(course.courseId),
    updatedAt: course.updatedAt,
  }));

  const publishedCourses = courses.filter(
    (course) => course.status === 'Published',
  );
  const draftCourses = courses.filter((course) => course.status === 'Draft');
  const archivedCourses = courses.filter(
    (course) => course.status === 'Archived',
  );
  const publishedEnrolments = publishedCourses.reduce(
    (total, course) => total + (course.enrolments ?? 0),
    0,
  );
  const summaryReady = !coursesQuery.isPending && !coursesQuery.isError;
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? '' : 's'}`;

  const visibleCourses = courses.filter(
    (course) =>
      (filter === 'All' || course.status === filter) &&
      (!normalisedQuery ||
        course.title.toLocaleLowerCase().includes(normalisedQuery)),
  );

  return (
    <main className="w-full space-y-6 pb-8">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <BookOpen className="size-4" /> Teaching
          </div>
          <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            My Courses
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage every course you teach and see how many students are
            enrolled.
          </p>
        </div>
        <CreateCourseDialog
          trigger={
            <Button>
              <CirclePlus /> Create course
            </Button>
          }
        />
      </section>

      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Course summary"
      >
        {[
          {
            label: 'Active courses',
            value: publishedCourses.length,
            detail: summariesQuery.isSuccess
              ? `${plural(publishedEnrolments, 'enrolment')} in total`
              : undefined,
          },
          { label: 'Draft courses', value: draftCourses.length },
          { label: 'Archived courses', value: archivedCourses.length },
        ].map((metric) => (
          <Card key={metric.label} className="gap-2 py-4">
            <CardContent className="px-5">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold">
                {summaryReady ? metric.value : '–'}
              </p>
              {summaryReady && metric.detail && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {metric.detail}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-4" aria-labelledby="course-list-heading">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <h2 id="course-list-heading" className="text-lg font-semibold">
              All courses
            </h2>
            <p className="text-sm text-muted-foreground">
              {visibleCourses.length}{' '}
              {visibleCourses.length === 1 ? 'course' : 'courses'} shown
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title"
                autoComplete="off"
                aria-label="Search courses"
                className="pl-9"
              />
            </div>
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(value) => {
                if (value) setFilter(value as CourseFilter);
              }}
              variant="outline"
              size="sm"
              className="max-w-full overflow-x-auto"
              aria-label="Filter courses by status"
            >
              {filters.map((item) => (
                <ToggleGroupItem
                  key={item}
                  value={item}
                  aria-label={`Show ${item.toLocaleLowerCase()} courses`}
                >
                  {item}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {coursesQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : coursesQuery.isError ? (
          <ErrorAlert type="error" header="Couldn't load your courses">
            {apiErrorMessage(coursesQuery.error)}
          </ErrorAlert>
        ) : visibleCourses.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleCourses.map((course) => (
              <Card
                key={course.courseId}
                className="h-full min-w-0 gap-4 overflow-hidden py-0 transition-shadow hover:shadow-md"
              >
                {course.imageUrl ? (
                  <img
                    src={course.imageUrl}
                    alt=""
                    width={640}
                    height={360}
                    loading="lazy"
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  <div
                    className={`flex aspect-video items-end bg-gradient-to-br p-5 ${courseSurface}`}
                  >
                    <div className="flex size-11 items-center justify-center rounded-xl bg-background/85 shadow-sm backdrop-blur-sm">
                      <BookOpen className="size-5" />
                    </div>
                  </div>
                )}
                <CardHeader className="gap-3 px-5">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <CardTitle className="min-w-0 break-words [overflow-wrap:anywhere] text-base leading-5">
                        {course.title}
                      </CardTitle>
                    </div>
                    <Badge
                      className={`shrink-0 ${courseStatusStyles[course.status]}`}
                    >
                      {course.status}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-3 break-words [overflow-wrap:anywhere]">
                    {course.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto space-y-4 px-5 pb-5">
                  <div className="rounded-lg border bg-muted/20 py-3 text-center">
                    <Users className="mx-auto size-4 text-muted-foreground" />
                    <p className="mt-1 text-sm font-semibold">
                      {course.enrolments ?? '–'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Enrolments
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updated {updatedFormat.format(new Date(course.updatedAt))}
                  </p>
                  <Button variant="outline" className="w-full" asChild>
                    <Link
                      to="/my-courses/$courseId"
                      params={{ courseId: course.courseId }}
                    >
                      Open course
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed py-12 text-center">
            <CardContent>
              <Search className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">No courses found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Try another search or status filter.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                type="button"
                onClick={() => {
                  setQuery('');
                  setFilter('All');
                }}
              >
                Clear filters
              </Button>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
