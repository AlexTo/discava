/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BarChart3,
  CalendarCheck,
  Clock3,
  GraduationCap,
  LayoutDashboard,
  MessageCircleMore,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/alert';
import { CourseThumbnail } from '../../components/course-thumbnail';
import { Spinner } from '../../components/spinner';
import { useCoreApi } from '../../hooks/useCoreApi';
import { categories, toDisplayCourse } from '../../lib/course-display';

const features = [
  {
    icon: LayoutDashboard,
    title: 'Everything in one place',
    description:
      'See your courses, upcoming work, announcements, and progress from one clear dashboard.',
  },
  {
    icon: CalendarCheck,
    title: 'Stay on track',
    description:
      'Keep deadlines visible and know what to focus on next, without hunting through every course.',
  },
  {
    icon: MessageCircleMore,
    title: 'Learn together',
    description:
      'Connect with teachers and classmates, ask questions, and keep course conversations flowing.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Sign in',
    description: 'Use the account provided by your learning organisation.',
  },
  {
    number: '02',
    title: 'Find your courses',
    description: 'Your current courses and learning materials are ready to go.',
  },
  {
    number: '03',
    title: 'Keep moving',
    description: 'Pick up where you left off and see your next milestone.',
  },
];

// What `/` shows signed-out visitors: the course catalogue and what
// Discava is. Signed-in students see SignedInHome instead.
export function Catalogue() {
  const [category, setCategory] = useState<(typeof categories)[number]>('All');

  const trpc = useCoreApi();
  const coursesQuery = useQuery(
    trpc.course.publicList.queryOptions({ limit: 100 }),
  );
  const courses = (coursesQuery.data?.items ?? []).map(toDisplayCourse);

  // Searching is the top bar's job (/search); this only narrows by category.
  const visibleCourses = courses.filter(
    (course) => category === 'All' || course.category === category,
  );

  return (
    <main className="w-full overflow-hidden text-left">
      <section id="courses" className="scroll-mt-20 px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Browse courses for every goal.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Choose a category, or search for a topic above, to find your next
              learning opportunity.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4 sm:p-5">
            <div
              className="flex flex-wrap gap-2"
              aria-label="Course categories"
            >
              {categories.map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={category === item ? 'default' : 'outline'}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>

          {!coursesQuery.isLoading && !coursesQuery.isError && (
            <div className="mt-7 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Showing {visibleCourses.length}{' '}
                {visibleCourses.length === 1 ? 'course' : 'courses'}
                {category !== 'All' ? ` in ${category}` : ''}
              </p>
              {category !== 'All' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCategory('All')}
                >
                  Show all
                </Button>
              )}
            </div>
          )}

          {coursesQuery.isLoading ? (
            <div className="mt-10 flex justify-center py-12">
              <Spinner />
            </div>
          ) : coursesQuery.isError ? (
            <div className="mt-10">
              <Alert type="error" header="Couldn't load courses">
                {apiErrorMessage(coursesQuery.error)}
              </Alert>
            </div>
          ) : (
            <>
              <div className="mt-10 grid gap-6 md:grid-cols-3">
                {visibleCourses.map((course) => (
                  <Card
                    key={course.courseId}
                    className="group overflow-hidden pt-0 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
                  >
                    <CourseThumbnail
                      course={course}
                      iconClassName="transition-transform group-hover:scale-110"
                    />
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-primary">
                          {course.category}
                        </p>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="size-3.5" /> {course.duration}
                        </span>
                      </div>
                      <CardTitle className="mt-2">{course.title}</CardTitle>
                      <CardDescription className="leading-6">
                        {course.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto flex items-center justify-between border-t pt-5">
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <BarChart3 className="size-4" /> {course.level}
                      </span>
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/learn/$courseId"
                          params={{ courseId: course.courseId }}
                          aria-label={`Preview ${course.title}`}
                        >
                          Learn more
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {visibleCourses.length === 0 && (
                <div className="mt-10 rounded-2xl border border-dashed px-6 py-14 text-center">
                  <Search className="mx-auto size-8 text-muted-foreground" />
                  <h3 className="mt-4 font-semibold">
                    {category !== 'All'
                      ? 'No matching courses'
                      : 'No courses available yet'}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {category !== 'All'
                      ? 'Try another category, or show all courses.'
                      : 'Check back soon for new courses.'}
                  </p>
                  {category !== 'All' && (
                    <Button
                      className="mt-5"
                      type="button"
                      variant="outline"
                      onClick={() => setCategory('All')}
                    >
                      Show all courses
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section
        id="features"
        className="scroll-mt-20 border-t bg-muted/20 px-6 py-20 lg:px-8"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Built for focus
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Spend less time searching. More time learning.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Discava brings the important parts of your study day together in a
              simple, welcoming workspace.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="bg-card/60 shadow-sm">
                <CardHeader>
                  <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="leading-7 text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/40 px-6 py-20 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              Start simply
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              From sign-in to study in moments.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              No complicated setup. Your learning organisation takes care of the
              details so you can get straight to your work.
            </p>
          </div>
          <ol className="grid gap-8 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.number}>
                <span className="font-mono text-sm font-bold text-primary">
                  {step.number}
                </span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 py-20 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground shadow-lg sm:px-12">
          <GraduationCap className="size-10" />
          <h2 className="mt-5 text-3xl font-bold tracking-tight">
            Ready to continue your learning?
          </h2>
          <p className="mt-4 max-w-xl text-primary-foreground/80">
            Sign in to view your courses, upcoming work, and latest updates.
          </p>
          <Button className="mt-7" size="lg" variant="secondary" asChild>
            <Link to="/signin">Go to your account</Link>
          </Button>
        </div>
      </section>

      <footer id="terms" className="border-t px-6 py-8 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Discava. Learning, made clearer.</p>
          <nav aria-label="Footer navigation" className="flex gap-6">
            <a
              className="transition-colors hover:text-foreground"
              href="#features"
            >
              About
            </a>
            <a
              className="transition-colors hover:text-foreground"
              href="mailto:support@discava.com"
            >
              Contact
            </a>
            <a
              className="transition-colors hover:text-foreground"
              href="#terms"
            >
              Terms
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
