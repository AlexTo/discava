/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import type { IMyEnrolment } from '@discava/core-api';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BookOpen, Sparkles } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { Alert } from '../../components/alert';
import {
  ContinueLink,
  CourseProgress,
  CourseProgressCard,
  UpNext,
} from '../../components/course-progress-card';
import { Spinner } from '../../components/spinner';
import { getUserIdentity } from '../../components/UserMenu/user-profile';
import { useCoreApi } from '../../hooks/useCoreApi';
import { toDisplayCourse } from '../../lib/course-display';

// How many of the student's other courses the home shows; My Learning has
// them all.
const OTHER_COURSES = 3;
const NEW_COURSES = 6;

// "Continue where you left off": the course the student was last active in.
function ResumeHero({
  firstName,
  course,
}: {
  firstName: string;
  course: IMyEnrolment | undefined;
}) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 px-6 py-6 text-primary-foreground shadow-sm sm:px-8">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {course ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-primary-foreground/80">
            {course
              ? 'Pick up where you left off.'
              : 'Find a course to start learning.'}
          </p>
        </div>
        {course ? (
          <div className="w-full space-y-3 rounded-xl bg-background p-5 text-foreground shadow-sm md:max-w-md">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Continue learning
            </p>
            <h2 className="text-lg font-semibold leading-6">{course.title}</h2>
            <UpNext course={course} />
            <CourseProgress course={course} />
            <ContinueLink course={course} className="w-full" />
          </div>
        ) : (
          <Button variant="secondary" size="lg" asChild>
            <Link to="/search" search={{}}>
              Browse courses
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * What `/` shows a signed-in student: the course they were last active in,
 * their other courses in progress, and published courses they haven't
 * started. Goals and streaks come later (#194).
 */
export function SignedInHome() {
  const { user } = useAuth();
  const { displayName } = getUserIdentity(user?.profile);
  const firstName = displayName.split(' ')[0] || 'there';
  const trpc = useCoreApi();
  const enrolmentsQuery = useQuery(trpc.course.myEnrolments.queryOptions());
  const newCoursesQuery = useQuery(
    trpc.course.publicList.queryOptions({ limit: 24 }),
  );

  if (enrolmentsQuery.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-7xl justify-center px-6 py-24 lg:px-8">
        <Spinner />
      </main>
    );
  }

  const enrolments = enrolmentsQuery.data?.items ?? [];
  // Most recently active first: the one in progress picks up the hero.
  const inProgress = enrolments.filter((e) => e.status === 'active');
  const [resume, ...others] = inProgress;
  const enrolled = new Set(enrolments.map((e) => e.courseId));
  const newCourses = (newCoursesQuery.data?.items ?? [])
    .filter((course) => !enrolled.has(course.courseId))
    .slice(0, NEW_COURSES)
    .map(toDisplayCourse);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-6 pt-6 pb-10 lg:px-8">
      {enrolmentsQuery.isError ? (
        <Alert type="error" header="Couldn't load your courses">
          {enrolmentsQuery.error.message}
        </Alert>
      ) : null}
      <ResumeHero firstName={firstName} course={resume} />

      {others.length > 0 ? (
        <section className="space-y-4" aria-labelledby="your-courses-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2
              id="your-courses-heading"
              className="text-xl font-semibold tracking-tight"
            >
              Your other courses
            </h2>
            <Button variant="link" className="h-auto px-0" asChild>
              <Link to="/my-learning">See all in My Learning</Link>
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {others.slice(0, OTHER_COURSES).map((course) => (
              <CourseProgressCard key={course.courseId} course={course} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="new-courses-heading">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h2
            id="new-courses-heading"
            className="text-xl font-semibold tracking-tight"
          >
            Courses to start
          </h2>
        </div>
        {newCoursesQuery.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : newCoursesQuery.isError ? (
          <Alert type="error" header="Couldn't load courses">
            {newCoursesQuery.error.message}
          </Alert>
        ) : newCourses.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            You're enrolled in every course there is. New ones will show up
            here.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {newCourses.map((course) => (
              <Card
                key={course.courseId}
                className="group gap-4 overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
              >
                <div
                  className={`flex h-20 items-end bg-gradient-to-br p-5 ${course.surface}`}
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-background/80 text-lg shadow-sm backdrop-blur-sm">
                    <span aria-hidden="true">{course.icon}</span>
                  </div>
                </div>
                <CardContent className="flex flex-1 flex-col gap-3 px-5 pb-5">
                  <div>
                    <h3 className="text-base font-semibold leading-5">
                      {course.title}
                    </h3>
                    {course.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {course.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex justify-end border-t pt-3">
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        to="/learn/$courseId"
                        params={{ courseId: course.courseId }}
                        aria-label={`View ${course.title}`}
                      >
                        View course
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {enrolments.length === 0 && !enrolmentsQuery.isError ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="size-4" /> Courses you enrol in show up here and
          in My Learning.
        </p>
      ) : null}
    </main>
  );
}
