/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@discava/common-shadcn/components/ui/toggle-group';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  CirclePlus,
  FileCheck2,
  GraduationCap,
  Search,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Alert } from '../../../components/alert';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../../components/course-status';
import { CreateCourseDialog } from '../../../components/create-course-dialog';
import { Spinner } from '../../../components/spinner';
import { useCoreApi } from '../../../hooks/useCoreApi';

export const Route = createFileRoute('/_authenticated/my-courses')({
  component: RouteComponent,
});

// Not yet backed by an API, so every course card shows this same mock
// workload/scheduling info until grading, enrolment, and module data exist.
const mockCourseDetails = {
  term: 'Semester 2, 2026',
  students: 24,
  ungraded: 18,
  modules: 8,
  next: 'Course content coming soon',
  updated: 'Updated recently',
  surface:
    'from-emerald-500/25 to-teal-500/10 text-emerald-700 dark:text-emerald-300',
};

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
  const coursesQuery = useQuery(
    trpc.course.listByInstructor.queryOptions(
      { instructorId: instructorId ?? '', limit: 100 },
      { enabled: Boolean(instructorId) },
    ),
  );

  const courses = (coursesQuery.data?.items ?? []).map((course) => ({
    courseId: course.courseId,
    title: course.title,
    description: course.description,
    status: courseStatusLabels[course.status] ?? 'Draft',
    ...mockCourseDetails,
  }));

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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            My Courses
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage every course you teach and see its current workload.
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
            value: '3',
            detail: '74 enrolled students',
          },
          {
            label: 'Draft courses',
            value: '1',
            detail: 'Preparing for publication',
          },
          {
            label: 'Awaiting grading',
            value: '33',
            detail: 'Across 3 assignments',
          },
        ].map((metric) => (
          <Card key={metric.label} className="gap-2 py-4">
            <CardContent className="px-5">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold">{metric.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {metric.detail}
              </p>
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
          <Alert type="error" header="Couldn't load your courses">
            {coursesQuery.error.message}
          </Alert>
        ) : visibleCourses.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleCourses.map((course) => (
              <Card
                key={course.courseId}
                className="h-full gap-4 overflow-hidden py-0 transition-shadow hover:shadow-md"
              >
                <div
                  className={`flex h-24 items-end bg-gradient-to-br p-5 ${course.surface}`}
                >
                  <div className="flex size-11 items-center justify-center rounded-xl bg-background/85 shadow-sm backdrop-blur-sm">
                    <BookOpen className="size-5" />
                  </div>
                </div>
                <CardHeader className="gap-3 px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-5">
                        {course.title}
                      </CardTitle>
                    </div>
                    <Badge className={courseStatusStyles[course.status]}>
                      {course.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {course.description || course.term}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto space-y-4 px-5 pb-5">
                  <div className="grid grid-cols-3 divide-x rounded-lg border bg-muted/20 py-3 text-center">
                    <div className="px-2">
                      <Users className="mx-auto size-4 text-muted-foreground" />
                      <p className="mt-1 text-sm font-semibold">
                        {course.students}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Students
                      </p>
                    </div>
                    <div className="px-2">
                      <FileCheck2 className="mx-auto size-4 text-muted-foreground" />
                      <p className="mt-1 text-sm font-semibold">
                        {course.ungraded}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Ungraded
                      </p>
                    </div>
                    <div className="px-2">
                      <BookOpen className="mx-auto size-4 text-muted-foreground" />
                      <p className="mt-1 text-sm font-semibold">
                        {course.modules}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Modules
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="mt-0.5 size-3 shrink-0" />{' '}
                      {course.next}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {course.updated}
                    </p>
                  </div>
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

      <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <GraduationCap className="size-4 shrink-0" /> Course titles and status
        are live; workload and scheduling details shown here are illustrative
        placeholders.
      </div>
    </main>
  );
}
