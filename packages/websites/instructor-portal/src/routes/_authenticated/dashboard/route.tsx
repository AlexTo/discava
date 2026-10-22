/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@discava/common-shadcn/components/ui/chart';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  AlertTriangle,
  BarChart3,
  GraduationCap,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import { Alert } from '../../../components/alert';
import { Spinner } from '../../../components/spinner';
import { useCoreApi } from '../../../hooks/useCoreApi';

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: RouteComponent,
});

// Deterministic pseudo-random helper so mock figures stay stable across
// re-renders instead of jumping around on every refetch.
function seededPercent(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

// Validated categorical palette (see the dataviz skill's reference palette) —
// fixed hue order, never cycled per-series within the first 8 slots.
const seriesPalette = [
  { light: '#2a78d6', dark: '#3987e5' }, // blue
  { light: '#eb6834', dark: '#d95926' }, // orange
  { light: '#1baf7a', dark: '#199e70' }, // aqua
  { light: '#eda100', dark: '#c98500' }, // yellow
  { light: '#e87ba4', dark: '#d55181' }, // magenta
  { light: '#008300', dark: '#008300' }, // green
  { light: '#4a3aa7', dark: '#9085e9' }, // violet
  { light: '#e34948', dark: '#e66767' }, // red
];

const progressChartConfig = {
  completed: {
    label: 'Completed',
    theme: { light: '#2a78d6', dark: '#3987e5' },
  },
  inProgress: {
    label: 'In progress',
    theme: { light: '#eb6834', dark: '#d95926' },
  },
  notStarted: {
    label: 'Not started',
    theme: { light: '#1baf7a', dark: '#199e70' },
  },
} satisfies ChartConfig;

// Illustrative only — no enrollment or lesson-completion tracking exists in
// the backend yet (see github issue #112), so every figure below is a
// deterministic mock derived from the course's real id/title.
function RouteComponent() {
  const auth = useAuth();
  const instructorId = auth.user?.profile.sub;
  const trpc = useCoreApi();
  const coursesQuery = useQuery(
    trpc.course.listByInstructor.queryOptions(
      { instructorId: instructorId ?? '', limit: 100 },
      { enabled: Boolean(instructorId) },
    ),
  );

  const courses = (coursesQuery.data?.items ?? []).map((course) => {
    const completed = seededPercent(`${course.courseId}-completed`, 20, 65);
    const remaining = 100 - completed;
    const inProgress = seededPercent(
      `${course.courseId}-inprogress`,
      10,
      Math.max(10, remaining - 5),
    );
    const notStarted = Math.max(0, remaining - inProgress);
    const enrolled = seededPercent(`${course.courseId}-enrolled`, 8, 60);
    const atRisk = seededPercent(`${course.courseId}-atrisk`, 0, 6);
    return {
      ...course,
      completed,
      inProgress,
      notStarted,
      enrolled,
      atRisk,
    };
  });

  const enrollmentChartConfig: ChartConfig = Object.fromEntries(
    courses.map((course, index) => [
      course.courseId,
      {
        label: course.title,
        theme: seriesPalette[index % seriesPalette.length],
      },
    ]),
  );

  const weeklyEnrollmentByCourse = Array.from({ length: 8 }, (_, week) => {
    const row: Record<string, string | number> = { week: `Wk ${week + 1}` };
    for (const course of courses) {
      row[course.courseId] = seededPercent(
        `${course.courseId}-week-${week}`,
        1,
        12,
      );
    }
    return row;
  });

  const totalStudents = courses.reduce((sum, c) => sum + c.enrolled, 0);
  const totalAtRisk = courses.reduce((sum, c) => sum + c.atRisk, 0);
  const avgCompletion = courses.length
    ? Math.round(
        courses.reduce((sum, c) => sum + c.completed, 0) / courses.length,
      )
    : 0;
  const activeCourses = courses.filter((c) => c.status === 'published');

  const summaryTiles = [
    {
      label: 'Enrolled students',
      value: totalStudents.toLocaleString(),
      detail: `Across ${courses.length} ${courses.length === 1 ? 'course' : 'courses'}`,
      icon: Users,
    },
    {
      label: 'Avg completion rate',
      value: `${avgCompletion}%`,
      detail: 'Weighted across your courses',
      icon: GraduationCap,
    },
    {
      label: 'Active courses',
      value: activeCourses.length.toString(),
      detail: 'Currently published',
      icon: BarChart3,
    },
    {
      label: 'At-risk students',
      value: totalAtRisk.toString(),
      detail: 'No activity in the last 14 days',
      icon: AlertTriangle,
    },
  ];

  return (
    <main className="w-full space-y-6 pb-8">
      <section>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
          <BarChart3 className="size-4" /> Insights
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Dashboard
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          See how your courses and students are progressing.
        </p>
      </section>

      {coursesQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : coursesQuery.isError ? (
        <Alert type="error" header="Couldn't load your courses">
          {apiErrorMessage(coursesQuery.error)}
        </Alert>
      ) : (
        <>
          <section
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Analytics summary"
          >
            {summaryTiles.map((tile) => (
              <Card key={tile.label} className="gap-2 py-4">
                <CardContent className="px-5">
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <tile.icon className="size-4" /> {tile.label}
                  </div>
                  <p className="mt-1 text-2xl font-bold">{tile.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tile.detail}
                  </p>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="size-4" /> Weekly enrollment by course
                </CardTitle>
                <CardDescription>
                  New students enrolled per week, by course, last 8 weeks
                </CardDescription>
              </CardHeader>
              <CardContent>
                {courses.length > 0 ? (
                  <ChartContainer
                    config={enrollmentChartConfig}
                    className="aspect-auto h-64 w-full"
                  >
                    <LineChart data={weeklyEnrollmentByCourse}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="week"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={32}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      {courses.map((course) => (
                        <Line
                          key={course.courseId}
                          type="monotone"
                          dataKey={course.courseId}
                          stroke={`var(--color-${course.courseId})`}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ChartContainer>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No courses yet — create one to see enrollment trends here.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="size-4" /> Student progress by
                  course
                </CardTitle>
                <CardDescription>
                  Share of enrolled students at each stage
                </CardDescription>
              </CardHeader>
              <CardContent>
                {courses.length > 0 ? (
                  <ChartContainer
                    config={progressChartConfig}
                    className="aspect-auto h-64 w-full"
                  >
                    <BarChart data={courses} layout="vertical">
                      <CartesianGrid horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        unit="%"
                      />
                      <YAxis
                        type="category"
                        dataKey="title"
                        tickLine={false}
                        axisLine={false}
                        width={96}
                        tickFormatter={(value: string) =>
                          value.length > 14 ? `${value.slice(0, 14)}…` : value
                        }
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      <Bar
                        dataKey="completed"
                        stackId="progress"
                        fill="var(--color-completed)"
                        radius={[4, 0, 0, 4]}
                      />
                      <Bar
                        dataKey="inProgress"
                        stackId="progress"
                        fill="var(--color-inProgress)"
                      />
                      <Bar
                        dataKey="notStarted"
                        stackId="progress"
                        fill="var(--color-notStarted)"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No courses yet — create one to see progress breakdowns here.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}

      <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <BarChart3 className="size-4 shrink-0" /> Course titles are live;
        enrollment, completion, and trend figures shown here are illustrative
        placeholders until enrollment and lesson-completion tracking exist.
      </div>
    </main>
  );
}
