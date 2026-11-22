/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  MessageCircleMore,
  Sparkles,
} from 'lucide-react';
import { useCoreApi } from '../../api';
import { CourseCard } from '../../components/course-card';
import { toDisplayCourse } from '../../lib/course-display';

const FEATURED_COURSES = 6;

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

// What `/` shows signed-out visitors: what Discava is, a few courses and a
// way into the full catalogue (/courses). Signed-in students see SignedInHome
// instead.
export function MarketingHome() {
  const trpc = useCoreApi();
  const categoriesQuery = useQuery(trpc.category.list.queryOptions());
  const categories = (categoriesQuery.data ?? []).filter(
    ({ courseCount }) => courseCount > 0,
  );
  const coursesQuery = useQuery(
    trpc.course.publicList.queryOptions({ limit: FEATURED_COURSES }),
  );
  const courses = (coursesQuery.data?.items ?? [])
    .slice(0, FEATURED_COURSES)
    .map(toDisplayCourse);

  return (
    <main className="w-full overflow-hidden text-left">
      <section className="relative border-b bg-gradient-to-b from-primary/10 via-primary/5 to-background">
        <div className="mx-auto flex max-w-7xl flex-col items-center px-6 py-20 text-center sm:py-28 lg:px-8">
          <p className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-4 py-1.5 text-sm font-medium text-primary shadow-sm">
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            Learn at your own pace
          </p>
          <h1 className="mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
            Learn something new, from people who know it.
          </h1>
          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Short lessons, clear progress and certificates you can share.
            Discava brings your courses together in one welcoming place.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/courses" search={{}}>
                Browse all courses
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/" hash="features">
                See how it works
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {courses.length > 0 && (
        <section id="courses" className="scroll-mt-20 px-6 py-20 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                  Popular right now
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Start with a course.
                </h2>
              </div>
              <Button variant="outline" asChild>
                <Link to="/courses" search={{}}>
                  Browse all courses
                </Link>
              </Button>
            </div>
            {categories.length > 0 && (
              <ul
                aria-label="Course categories"
                className="mt-6 flex gap-2 overflow-x-auto pb-1"
              >
                {categories.map(({ id, name, slug }) => (
                  <li key={id} className="shrink-0">
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/category/$slug" params={{ slug }}>
                        {name}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <CourseCard key={course.courseId} course={course} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section
        id="features"
        className="scroll-mt-20 border-t bg-muted/20 px-6 py-20 lg:px-8"
      >
        <div className="mx-auto max-w-7xl">
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
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-start">
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

      <footer className="border-t px-6 py-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Discava. Learning, made clearer.</p>
          <nav aria-label="Footer navigation" className="flex gap-6">
            <Link
              className="transition-colors hover:text-foreground"
              to="/"
              hash="features"
            >
              About
            </Link>
            <a
              className="transition-colors hover:text-foreground"
              href="mailto:support@discava.com"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
