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
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@discava/common-shadcn/components/ui/carousel';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { Separator } from '@discava/common-shadcn/components/ui/separator';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@discava/common-shadcn/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@discava/common-shadcn/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Flame,
  GraduationCap,
  Info,
  ListTodo,
  Megaphone,
  Sparkles,
} from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Alert } from '../../components/alert';
import { Spinner } from '../../components/spinner';
import { getUserIdentity } from '../../components/UserMenu/user-profile';
import { useCoreApi } from '../../hooks/useCoreApi';
import { categories, toDisplayCourse } from '../../lib/course-display';

const courses = [
  {
    code: 'BIO102',
    title: 'Foundations of Biology',
    detail: 'Module 4 · Cell structure and function',
    progress: 68,
    completed: 13,
    total: 19,
    colour: 'bg-emerald-500',
    surface:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  {
    code: 'MTH201',
    title: 'Applied Mathematics',
    detail: 'Week 6 · Differential equations',
    progress: 45,
    completed: 9,
    total: 20,
    colour: 'bg-blue-500',
    surface: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  },
  {
    code: 'COM105',
    title: 'Academic Communication',
    detail: 'Unit 3 · Research and referencing',
    progress: 82,
    completed: 14,
    total: 17,
    colour: 'bg-violet-500',
    surface:
      'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  },
  {
    code: 'DAT110',
    title: 'Data Literacy',
    detail: 'Module 2 · Understanding data distributions',
    progress: 24,
    completed: 4,
    total: 17,
    colour: 'bg-cyan-500',
    surface: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300',
  },
  {
    code: 'PSY101',
    title: 'Introduction to Psychology',
    detail: 'Week 3 · Learning and memory',
    progress: 57,
    completed: 12,
    total: 21,
    colour: 'bg-rose-500',
    surface: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  },
];

const deadlines = [
  {
    day: '28',
    month: 'AUG',
    title: 'Lab report: Enzyme activity',
    course: 'Foundations of Biology',
    timing: 'Due tomorrow · 11:59 pm',
    status: 'Due tomorrow',
    urgent: true,
  },
  {
    day: '02',
    month: 'SEP',
    title: 'Problem set 5',
    course: 'Applied Mathematics',
    timing: 'Due in 6 days · 5:00 pm',
    status: 'Not started',
    urgent: false,
  },
  {
    day: '06',
    month: 'SEP',
    title: 'Annotated bibliography',
    course: 'Academic Communication',
    timing: 'Due in 10 days · 11:59 pm',
    status: 'In progress',
    urgent: false,
  },
];

const todayTasks = [
  {
    title: 'Quiz 3: Cell structure',
    course: 'Foundations of Biology',
    timing: 'Overdue since yesterday, 11:59 pm',
    status: 'Overdue',
    action: 'Complete quiz',
    urgent: true,
  },
  {
    title: 'Lesson 6: Differential equations',
    course: 'Applied Mathematics',
    timing: 'Next activity · about 25 minutes',
    status: 'Next up',
    action: 'Continue lesson',
    urgent: false,
  },
];

// What `/` shows a signed-in student. Still mostly mock data: #194 step 2
// replaces it with their real enrolments and next items.
export function SignedInHome() {
  const { user } = useAuth();
  const { displayName } = getUserIdentity(user?.profile);
  const firstName = displayName.split(' ')[0] || 'Alex';
  const [learningView, setLearningView] = useState<'courses' | 'timeline'>(
    () =>
      window.localStorage.getItem('student-home-learning-view') === 'timeline'
        ? 'timeline'
        : 'courses',
  );
  const [courseCategory, setCourseCategory] =
    useState<(typeof categories)[number]>('All');

  useEffect(() => {
    window.localStorage.setItem('student-home-learning-view', learningView);
  }, [learningView]);

  const trpc = useCoreApi();
  const exploreCoursesQuery = useQuery(
    trpc.course.publicList.queryOptions({ limit: 12 }),
  );
  const exploreCourses = (exploreCoursesQuery.data?.items ?? []).map(
    toDisplayCourse,
  );
  const filteredExploreCourses =
    courseCategory === 'All'
      ? exploreCourses
      : exploreCourses.filter((course) => course.category === courseCategory);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 pt-6 pb-8 lg:px-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 px-6 py-5 text-primary-foreground shadow-sm sm:px-8 sm:py-6">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full border-[40px] border-white/10" />
        <div className="pointer-events-none absolute -bottom-20 right-36 size-48 rounded-full bg-white/5" />
        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-primary-foreground/75">
              <span>Thursday, 27 August</span>
              <Badge className="border-transparent bg-white/10 text-primary-foreground hover:bg-white/10">
                <CheckCircle2 className="size-3.5" /> Active enrollment
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-5 text-primary-foreground/80">
              Here is what needs your attention today.
            </p>
          </div>
          <div className="w-full rounded-xl bg-background p-4 text-foreground shadow-sm md:max-w-md">
            <div className="flex items-center gap-2">
              <Flame className="size-5 text-amber-500" />
              <p className="text-lg font-semibold">3 week streak</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="About weekly learning streaks"
                  >
                    <Info className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Complete learning on at least 3 days each week to continue
                  your streak.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Complete learning on 3 days this week to keep your streak going.
            </p>
            <div
              className="mt-3 grid grid-cols-7 gap-1.5"
              aria-label="Weekly learning activity"
            >
              {[
                { day: 'Mo', complete: true },
                { day: 'Tu', complete: true },
                { day: 'We', complete: false },
                { day: 'Th', complete: true, current: true },
                { day: 'Fr', complete: false },
                { day: 'Sa', complete: false },
                { day: 'Su', complete: false },
              ].map((item) => (
                <div
                  key={item.day}
                  className={`flex aspect-square items-center justify-center rounded-md border text-xs font-medium ${item.complete ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'} ${item.current ? 'ring-2 ring-primary/25 ring-offset-1 ring-offset-background' : ''}`}
                  aria-label={`${item.day}: ${item.complete ? 'learning completed' : 'no learning yet'}${item.current ? ', today' : ''}`}
                >
                  {item.day}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">3 items</span>{' '}
                completed ·{' '}
                <span className="font-semibold text-foreground">
                  82 minutes
                </span>{' '}
                learned
              </p>
              <Button variant="link" size="sm" className="h-auto px-0">
                Edit weekly target
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="today-heading">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b bg-muted/30 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ListTodo className="size-5 text-primary" />
                  <CardTitle id="today-heading" className="text-lg">
                    Today
                  </CardTitle>
                </div>
                <CardDescription className="mt-1">
                  2 actions need your attention
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid p-0 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            {todayTasks.map((task, index) => (
              <Fragment key={task.title}>
                {index > 0 && (
                  <>
                    <Separator className="md:hidden" />
                    <Separator
                      orientation="vertical"
                      className="hidden h-full md:block"
                    />
                  </>
                )}
                <article className="flex flex-col justify-between gap-4 bg-card p-5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 gap-3">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${task.urgent ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'bg-primary/10 text-primary'}`}
                    >
                      {task.urgent ? (
                        <AlertCircle className="size-5" />
                      ) : (
                        <BookOpen className="size-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <Badge
                        variant={task.urgent ? 'destructive' : 'secondary'}
                        className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${task.urgent ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-primary/10 text-primary'}`}
                      >
                        {task.status}
                      </Badge>
                      <h2 className="truncate text-sm font-semibold">
                        {task.title}
                      </h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {task.course}
                      </p>
                      <p
                        className={`mt-1 flex items-center gap-1 text-xs ${task.urgent ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                      >
                        <Clock3 className="size-3" /> {task.timing}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={task.urgent ? 'default' : 'outline'}
                    className="shrink-0"
                  >
                    {task.action} <ArrowRight />
                  </Button>
                </article>
              </Fragment>
            ))}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-4" aria-labelledby="courses-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2
                id="courses-heading"
                className="text-xl font-semibold tracking-tight"
              >
                Continue learning
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your courses for this semester
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={learningView}
              onValueChange={(value) => {
                if (value === 'courses' || value === 'timeline') {
                  setLearningView(value);
                }
              }}
              variant="outline"
              className="rounded-lg bg-muted/40 p-1"
              aria-label="Learning view"
            >
              <ToggleGroupItem value="courses" aria-label="Show courses">
                <BookOpen /> Courses
              </ToggleGroupItem>
              <ToggleGroupItem value="timeline" aria-label="Show timeline">
                <ListTodo /> Timeline
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {learningView === 'courses' ? (
            <Carousel
              opts={{ align: 'start' }}
              className="group/carousel"
              aria-label="Enrolled courses"
            >
              <CarouselContent className="-ml-4 pb-1">
                {courses.map((course) => (
                  <CarouselItem
                    key={course.code}
                    className="basis-[85%] pl-4 sm:basis-1/2 lg:basis-1/3"
                  >
                    <Card className="h-full gap-4 py-5 transition-shadow hover:shadow-md">
                      <CardHeader className="gap-4 px-5">
                        <div
                          className={`flex size-11 items-center justify-center rounded-xl ${course.surface}`}
                        >
                          <BookOpen className="size-5" />
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground">
                            {course.code}
                          </p>
                          <CardTitle className="min-h-10 text-base leading-5">
                            {course.title}
                          </CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent className="mt-auto space-y-4 px-5">
                        <CardDescription className="min-h-10 leading-5">
                          {course.detail}
                        </CardDescription>
                        <div>
                          <div className="mb-2 flex items-start gap-2 text-xs">
                            <span className="min-w-0 flex-1 leading-4 text-muted-foreground">
                              {course.completed} of {course.total} activities
                              complete
                            </span>
                            <span
                              className="shrink-0 font-semibold leading-4"
                              aria-label={`${course.progress} percent`}
                            >
                              {course.progress}%
                            </span>
                          </div>
                          <Progress
                            value={course.progress}
                            aria-label={`${course.title} progress`}
                            className="bg-muted"
                            indicatorClassName={course.colour}
                          />
                        </div>
                        <Button
                          className="h-auto min-h-9 w-full whitespace-normal px-3 py-2 leading-5"
                          asChild
                        >
                          <Link
                            to="/learn/$courseId/home"
                            params={{ courseId: course.code }}
                          >
                            <span>Continue</span>
                            <ArrowRight className="shrink-0" />
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="left-2 opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100" />
              <CarouselNext className="right-2 opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100" />
            </Carousel>
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <CardContent className="divide-y p-0">
                {deadlines.map((task, index) => (
                  <Fragment key={task.title}>
                    {index > 0 && <Separator />}
                    <button
                      type="button"
                      className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/50 sm:px-5"
                    >
                      <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border bg-background">
                        <span className="text-sm font-bold leading-4">
                          {task.day}
                        </span>
                        <span className="text-[9px] font-semibold">
                          {task.month}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {task.title}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {task.status}
                          </Badge>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {task.course} · {task.timing}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </Fragment>
                ))}
              </CardContent>
            </Card>
          )}
        </section>

        <Card className="gap-4 py-5">
          <CardHeader className="px-5">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Upcoming deadlines</CardTitle>
                <CardDescription className="mt-1">
                  Stay on top of your work
                </CardDescription>
              </div>
              <div className="rounded-lg bg-muted p-2 text-muted-foreground">
                <CalendarDays className="size-5" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-3">
            {deadlines.map((deadline, index) => (
              <Fragment key={deadline.title}>
                {index > 0 && <Separator className="mx-2 w-auto" />}
                <button
                  type="button"
                  className="group flex w-full gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted/70"
                >
                  <span
                    className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border ${deadline.urgent ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300' : 'bg-background'}`}
                  >
                    <span className="text-base font-bold leading-4">
                      {deadline.day}
                    </span>
                    <span className="text-[10px] font-semibold">
                      {deadline.month}
                    </span>
                  </span>
                  <span className="min-w-0 py-0.5">
                    <span className="block truncate text-sm font-semibold">
                      {deadline.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {deadline.course}
                    </span>
                    <span
                      className={`mt-1 flex items-center gap-1 text-xs ${deadline.urgent ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                    >
                      <Clock3 className="size-3" /> {deadline.timing}
                    </span>
                  </span>
                </button>
              </Fragment>
            ))}
          </CardContent>
          <div className="px-5">
            <Button variant="outline" className="w-full">
              View full calendar
            </Button>
          </div>
        </Card>
      </div>

      <Card className="gap-4 py-5">
        <CardHeader className="px-5 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Announcements</CardTitle>
              <CardDescription className="mt-1">
                Latest updates from your learning community
              </CardDescription>
            </div>
            <Bell className="size-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-5 sm:px-6">
          <article className="flex gap-4 rounded-xl border bg-muted/30 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">
                  Semester census date reminder
                </h3>
                <Badge className="bg-primary/10 text-[10px] font-bold uppercase tracking-wide text-primary hover:bg-primary/10">
                  New
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Review your enrollment before the census date on 31 August.
                Contact Student Services if you need help.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Student Services · 2 hours ago
              </p>
            </div>
          </article>
          <article className="flex gap-4 rounded-xl p-4 transition-colors hover:bg-muted/50">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50">
              <FileText className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                Library workshop: Research essentials
              </h3>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Bookings are open for next week&apos;s online research and
                referencing workshop.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Campus Library · Yesterday
              </p>
            </div>
          </article>
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="explore-heading">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              <h2
                id="explore-heading"
                className="text-xl font-semibold tracking-tight"
              >
                Explore courses
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              A few suggestions based on your Data Analyst career goal
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={courseCategory}
            onValueChange={(value) => {
              if ((categories as readonly string[]).includes(value)) {
                setCourseCategory(value as (typeof categories)[number]);
              }
            }}
            spacing={2}
            variant="outline"
            className="flex flex-wrap"
            aria-label="Course categories"
          >
            {categories.map((category) => (
              <ToggleGroupItem
                key={category}
                value={category}
                aria-label={`Show ${category} courses`}
              >
                {category}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {exploreCoursesQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : exploreCoursesQuery.isError ? (
          <Alert type="error" header="Couldn't load courses">
            {exploreCoursesQuery.error.message}
          </Alert>
        ) : filteredExploreCourses.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            No courses to show in this category yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {filteredExploreCourses.map((course) => (
              <Card
                key={course.courseId}
                className="group gap-4 overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div
                  className={`flex h-24 items-end bg-gradient-to-br p-5 ${course.surface}`}
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-background/80 text-lg shadow-sm backdrop-blur-sm">
                    <span aria-hidden="true">{course.icon}</span>
                  </div>
                </div>
                <CardContent className="flex flex-1 flex-col gap-3 px-5 pb-5">
                  <div>
                    <p className="text-xs font-semibold text-primary">
                      {course.category}
                    </p>
                    <CardTitle className="mt-1 text-base leading-5">
                      {course.title}
                    </CardTitle>
                    <CardDescription className="mt-1 line-clamp-2">
                      {course.description}
                    </CardDescription>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5" /> {course.duration} ·{' '}
                      {course.level}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Preview ${course.title}`}
                      asChild
                    >
                      <Link
                        to="/learn/$courseId"
                        params={{ courseId: course.courseId }}
                      >
                        Preview <ArrowRight />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Recommendations use your selected career goal and recent learning.
          </p>
          <Button variant="ghost" size="sm">
            Manage interests
          </Button>
        </div>
      </section>

      <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <GraduationCap className="size-4" /> Prototype content shown for design
        feedback; course data is illustrative.
      </div>
    </main>
  );
}
