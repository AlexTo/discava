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
import { Separator } from '@discava/common-shadcn/components/ui/separator';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CirclePlus,
  Clock3,
  FileCheck2,
  GraduationCap,
  Megaphone,
  MoreHorizontal,
  PencilLine,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react';
import { Fragment } from 'react';
import { useAuth } from 'react-oidc-context';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../components/course-status';
import { CreateCourseDialog } from '../../components/create-course-dialog';
import { getUserIdentity } from '../../components/UserMenu/user-profile';

export const Route = createFileRoute('/_authenticated/')({
  component: RouteComponent,
});

const gradingQueue = [
  {
    title: 'Lab report: Enzyme activity',
    course: 'BIO102 · Foundations of Biology',
    ungraded: 18,
    submitted: 24,
    timing: 'Oldest submission waiting 3 days',
    urgent: true,
  },
  {
    title: 'Problem set 5',
    course: 'MTH201 · Applied Mathematics',
    ungraded: 9,
    submitted: 31,
    timing: 'Due today at 5:00 pm',
    urgent: true,
  },
  {
    title: 'Annotated bibliography',
    course: 'COM105 · Academic Communication',
    ungraded: 6,
    submitted: 19,
    timing: 'Oldest submission waiting 1 day',
    urgent: false,
  },
];

const courses = [
  {
    code: 'BIO102',
    title: 'Foundations of Biology',
    status: 'Published' as CourseStatus,
    students: 24,
    ungraded: 18,
    next: 'Lab report due today',
    surface:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  {
    code: 'MTH201',
    title: 'Applied Mathematics',
    status: 'Published' as CourseStatus,
    students: 31,
    ungraded: 9,
    next: 'Problem set 5 due today',
    surface: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  },
  {
    code: 'COM105',
    title: 'Academic Communication',
    status: 'Published' as CourseStatus,
    students: 19,
    ungraded: 6,
    next: 'Bibliography due 6 Sep',
    surface:
      'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  },
  {
    code: 'DAT210',
    title: 'Data Visualisation',
    status: 'Draft' as CourseStatus,
    students: 0,
    ungraded: 0,
    next: 'Course starts 14 Sep',
    surface:
      'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  },
];

const upcoming = [
  {
    day: '29',
    month: 'AUG',
    title: 'Problem set 5 closes',
    course: 'Applied Mathematics',
    timing: 'Today · 5:00 pm',
    urgent: true,
  },
  {
    day: '31',
    month: 'AUG',
    title: 'Week 7 content publishes',
    course: 'Foundations of Biology',
    timing: 'Monday · 9:00 am',
    urgent: false,
  },
  {
    day: '06',
    month: 'SEP',
    title: 'Annotated bibliography due',
    course: 'Academic Communication',
    timing: 'Sunday · 11:59 pm',
    urgent: false,
  },
];

const activity = [
  {
    icon: PencilLine,
    title: 'Mia Chen submitted Lab report: Enzyme activity',
    detail: 'Foundations of Biology · 12 minutes ago',
  },
  {
    icon: UserPlus,
    title: '3 students joined Applied Mathematics',
    detail: 'Enrolment update · 1 hour ago',
  },
  {
    icon: CheckCircle2,
    title: 'Oliver Smith completed Academic Communication',
    detail: 'Course completion · 3 hours ago',
  },
];

const quickActions = [
  { label: 'Create a course', icon: CirclePlus },
  { label: 'Create an assignment', icon: PencilLine },
  { label: 'Open grading queue', icon: FileCheck2 },
];

function RouteComponent() {
  const { user } = useAuth();
  const { displayName } = getUserIdentity(user?.profile);
  const firstName = displayName.split(' ')[0] || 'Alex';
  const today = new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <main className="w-full space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 px-6 py-6 text-primary-foreground shadow-sm sm:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full border-[40px] border-white/10" />
        <div className="pointer-events-none absolute -bottom-20 right-36 size-48 rounded-full bg-white/5" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="mb-2 text-sm font-medium text-primary-foreground/75">
              {today}
            </p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-5 text-primary-foreground/80">
              You have 33 submissions waiting for feedback across 3 courses.
            </p>
          </div>
          <div
            className="grid grid-cols-3 gap-2 sm:gap-3"
            aria-label="Teaching overview"
          >
            {[
              { value: '4', label: 'Courses' },
              { value: '74', label: 'Students' },
              { value: '33', label: 'To grade' },
            ].map((metric) => (
              <div
                key={metric.label}
                className="min-w-20 rounded-xl bg-white/10 px-3 py-3 text-center backdrop-blur-sm sm:min-w-24"
              >
                <p className="text-xl font-bold">{metric.value}</p>
                <p className="text-xs text-primary-foreground/75">
                  {metric.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="attention-heading">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b bg-muted/30 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="size-5 text-primary" />
                  <CardTitle id="attention-heading" className="text-lg">
                    Needs attention
                  </CardTitle>
                </div>
                <CardDescription className="mt-1">
                  Submissions awaiting evaluation, oldest first
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" type="button">
                View grading queue
              </Button>
            </div>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {gradingQueue.map((item) => (
              <article
                key={item.title}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:px-6"
              >
                <div
                  className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${item.urgent ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400' : 'bg-primary/10 text-primary'}`}
                >
                  <FileCheck2 className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{item.title}</h2>
                    {item.urgent && (
                      <Badge
                        variant="destructive"
                        className="text-[10px] uppercase"
                      >
                        Priority
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {item.course}
                  </p>
                  <p
                    className={`mt-1 flex items-center gap-1 text-xs ${item.urgent ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                  >
                    <Clock3 className="size-3" /> {item.timing}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <div className="text-right">
                    <p className="text-lg font-bold">{item.ungraded}</p>
                    <p className="text-xs text-muted-foreground">
                      of {item.submitted} ungraded
                    </p>
                  </div>
                  <Button size="sm" type="button">
                    Grade
                  </Button>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4" aria-labelledby="courses-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="courses-heading"
              className="text-xl font-semibold tracking-tight"
            >
              My courses
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Course health and teaching workload at a glance
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/my-courses">View all courses</Link>
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {courses.map((course) => (
            <Card
              key={course.code}
              className="h-full gap-4 py-5 transition-shadow hover:shadow-md"
            >
              <CardHeader className="gap-4 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`flex size-11 items-center justify-center rounded-xl ${course.surface}`}
                  >
                    <BookOpen className="size-5" />
                  </div>
                  <Badge className={courseStatusStyles[course.status]}>
                    {course.status}
                  </Badge>
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
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3" /> Students
                    </p>
                    <p className="mt-1 font-semibold">{course.students}</p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FileCheck2 className="size-3" /> Ungraded
                    </p>
                    <p className="mt-1 font-semibold">{course.ungraded}</p>
                  </div>
                </div>
                <p className="flex min-h-8 items-start gap-1.5 text-xs leading-4 text-muted-foreground">
                  <CalendarDays className="mt-0.5 size-3 shrink-0" />{' '}
                  {course.next}
                </p>
                <Button variant="outline" className="w-full" asChild>
                  <Link
                    to="/my-courses/$courseId"
                    params={{ courseId: course.code }}
                  >
                    Open course
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="gap-4 py-5">
          <CardHeader className="px-5 sm:px-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Recent activity</CardTitle>
                <CardDescription className="mt-1">
                  Latest updates across your courses
                </CardDescription>
              </div>
              <Sparkles className="size-5 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-3 sm:px-4">
            {activity.map((item, index) => (
              <Fragment key={item.title}>
                {index > 0 && <Separator className="mx-2 w-auto" />}
                <article className="flex items-start gap-3 rounded-xl p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium leading-5">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    aria-label={`More options for ${item.title}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </article>
              </Fragment>
            ))}
          </CardContent>
          <div className="px-5 sm:px-6">
            <Button variant="outline" className="w-full" type="button">
              View all activity
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="gap-4 py-5">
            <CardHeader className="px-5">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Upcoming</CardTitle>
                  <CardDescription className="mt-1">
                    Across all courses
                  </CardDescription>
                </div>
                <CalendarDays className="size-5 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1 px-3">
              {upcoming.map((item, index) => (
                <Fragment key={item.title}>
                  {index > 0 && <Separator className="mx-2 w-auto" />}
                  <article className="flex gap-3 p-2">
                    <div
                      className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border ${item.urgent ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300' : 'bg-background'}`}
                    >
                      <span className="text-base font-bold leading-4">
                        {item.day}
                      </span>
                      <span className="text-[10px] font-semibold">
                        {item.month}
                      </span>
                    </div>
                    <div className="min-w-0 py-0.5">
                      <h3 className="truncate text-sm font-semibold">
                        {item.title}
                      </h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.course}
                      </p>
                      <p
                        className={`mt-1 text-xs ${item.urgent ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                      >
                        {item.timing}
                      </p>
                    </div>
                  </article>
                </Fragment>
              ))}
            </CardContent>
            <div className="px-5">
              <Button variant="outline" className="w-full" type="button">
                View calendar
              </Button>
            </div>
          </Card>

          <Card className="gap-3 py-5">
            <CardHeader className="px-5">
              <CardTitle className="text-lg">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5">
              {quickActions.map((action) =>
                action.label === 'Create a course' ? (
                  <CreateCourseDialog
                    key={action.label}
                    trigger={
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        type="button"
                      >
                        <action.icon /> {action.label}
                      </Button>
                    }
                  />
                ) : (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="w-full justify-start"
                    type="button"
                  >
                    <action.icon /> {action.label}
                  </Button>
                ),
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="gap-3 border-dashed bg-muted/30 py-4">
        <CardContent className="flex flex-col gap-3 px-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Megaphone className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                Share feedback on this dashboard
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Which information would help you start your teaching day?
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" type="button">
            Give feedback
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <GraduationCap className="size-4 shrink-0" /> Prototype content shown
        for design feedback; course and submission data is illustrative.
      </div>
    </main>
  );
}
