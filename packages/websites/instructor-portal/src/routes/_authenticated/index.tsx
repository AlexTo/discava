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
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { relativeTime } from '@discava/common-web-utils/discussion';
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { getUserIdentity } from '@discava/common-web-utils/user-profile';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, CirclePlus } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { useCoreApi, useInstructorApi } from '../../api';
import { CreateCourseDialog } from '../../components/create-course-dialog';
import { type CourseStatus, courseStatusStyles } from '../../lib/course-status';

export const Route = createFileRoute('/_authenticated/')({
  component: RouteComponent,
});

const HOME_COURSE_LIMIT = 6;
const HOME_QUEUE_LIMIT = 10;

const courseStatusLabels: Record<string, CourseStatus> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

function RouteComponent() {
  const auth = useAuth();
  const { displayName } = getUserIdentity(auth.user?.profile);
  const firstName = displayName.split(' ')[0];
  const today = new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const instructorId = auth.user?.profile.sub;
  const trpc = useCoreApi();
  const publicMediaUrl = usePublicMediaUrl();
  const coursesQuery = useQuery(
    trpc.course.listByInstructor.queryOptions(
      { instructorId: instructorId ?? '', limit: 100 },
      { enabled: Boolean(instructorId) },
    ),
  );

  const instructorApi = useInstructorApi();
  const queueQuery = useQuery(
    instructorApi.gradingQueue.list.queryOptions({ limit: HOME_QUEUE_LIMIT }),
  );

  const activeCourses = (coursesQuery.data?.items ?? []).filter(
    (course) => course.status !== 'archived',
  );
  const isPending = !instructorId || coursesQuery.isPending;

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
            <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
              {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-5 text-primary-foreground/80">
              Your courses are below.
            </p>
          </div>
          {!isPending && !coursesQuery.isError && (
            <div
              className="grid grid-cols-1 gap-2 sm:gap-3"
              aria-label="Teaching overview"
            >
              <div className="min-w-20 rounded-xl bg-white/10 px-3 py-3 text-center backdrop-blur-sm sm:min-w-24">
                <p className="text-xl font-bold">{activeCourses.length}</p>
                <p className="text-xs text-primary-foreground/75">Courses</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="grading-queue-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="grading-queue-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Waiting for grading
          </h2>
          {queueQuery.data && queueQuery.data.total > 0 && (
            <Badge variant="secondary">{queueQuery.data.total}</Badge>
          )}
        </div>
        {queueQuery.isPending ? (
          <p className="text-sm text-muted-foreground">
            Loading the grading queue…
          </p>
        ) : queueQuery.isError ? (
          <ErrorAlert
            type="error"
            header="Couldn't load the grading queue"
            onRetry={() => void queueQuery.refetch()}
          >
            {apiErrorMessage(queueQuery.error)}
          </ErrorAlert>
        ) : queueQuery.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting for grading.
          </p>
        ) : (
          <Card className="py-0">
            <ul className="divide-y">
              {queueQuery.data.items.map((entry) => (
                <li
                  key={`${entry.courseId}#${entry.contentItemId}#${entry.userId}`}
                >
                  <Link
                    to="/my-courses/$courseId/assignments/$contentItemId/submissions/$userId"
                    params={{
                      courseId: entry.courseId,
                      contentItemId: entry.contentItemId,
                      userId: entry.userId,
                    }}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{entry.displayName}</span>
                      <span className="text-muted-foreground">
                        {' · '}
                        {entry.assignmentTitle}
                        {' · '}
                        {entry.courseTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Waited {relativeTime(entry.submittedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="courses-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="courses-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Your courses
          </h2>
          <div className="flex gap-2">
            <CreateCourseDialog
              trigger={
                <Button size="sm" type="button">
                  Create a course
                </Button>
              }
            />
            <Button variant="outline" size="sm" asChild>
              <Link to="/my-courses">View all courses</Link>
            </Button>
          </div>
        </div>
        {isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : coursesQuery.isError ? (
          <div className="space-y-3">
            <ErrorAlert type="error" header="Couldn't load your courses">
              {apiErrorMessage(coursesQuery.error)}
            </ErrorAlert>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => coursesQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : activeCourses.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {activeCourses.slice(0, HOME_COURSE_LIMIT).map((course) => {
              const imageUrl = publicMediaUrl(course.imageKey);
              const status = courseStatusLabels[course.status] ?? 'Draft';
              return (
                <Link
                  key={course.courseId}
                  to="/my-courses/$courseId"
                  params={{ courseId: course.courseId }}
                  className="block h-full"
                >
                  <Card className="h-full gap-4 overflow-hidden py-0 transition-shadow hover:shadow-md">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt=""
                        width={640}
                        height={360}
                        loading="lazy"
                        className="aspect-video w-full object-cover"
                      />
                    ) : (
                      <div
                        data-testid="course-placeholder"
                        className="flex aspect-video items-end bg-gradient-to-br from-emerald-500/25 to-teal-500/10 p-5 text-emerald-700 dark:text-emerald-300"
                      >
                        <div className="flex size-11 items-center justify-center rounded-xl bg-background/85 shadow-sm backdrop-blur-sm">
                          <BookOpen className="size-5" />
                        </div>
                      </div>
                    )}
                    <CardHeader className="px-5 pb-5">
                      <div className="flex items-start justify-between gap-3">
                        <CardTitle
                          className="text-base leading-5"
                          // biome-ignore lint/a11y/useSemanticElements: CardTitle renders a div; the page's course titles are level-3 headings
                          role="heading"
                          aria-level={3}
                        >
                          {course.title}
                        </CardTitle>
                        <Badge className={courseStatusStyles[status]}>
                          {status}
                        </Badge>
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed py-12 text-center">
            <CardContent>
              <BookOpen className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">
                You don't teach any courses yet
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first course to get started.
              </p>
              <CreateCourseDialog
                trigger={
                  <Button className="mt-4" type="button">
                    <CirclePlus /> Create a course
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
