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
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  MessageCircleMore,
} from 'lucide-react';
import { useCoreApi } from '../../api';
import { CatalogueResults } from '../../components/catalogue-results';
import {
  type CatalogueFilters,
  catalogueFiltersToSearch,
  parseCatalogueFilters,
} from '../../lib/catalogue-filters';

const homeRoute = getRouteApi('/');

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
  const filters = parseCatalogueFilters(homeRoute.useSearch());
  const navigate = homeRoute.useNavigate();
  const setFilters = (next: CatalogueFilters) =>
    navigate({ search: catalogueFiltersToSearch(next) });

  const trpc = useCoreApi();
  const categoriesQuery = useQuery(trpc.category.list.queryOptions());
  const categories = categoriesQuery.data ?? [];

  // Searching is the top bar's job (/search); this narrows by category and
  // the filters beside the courses.
  return (
    <main className="w-full overflow-hidden text-left">
      <section id="courses" className="scroll-mt-20 px-6 py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Browse courses for every goal.
            </h1>
            <p className="mt-4 text-muted-foreground">
              Choose a category, or search for a topic above, to find your next
              learning opportunity.
            </p>
          </div>

          {categories.length > 0 && (
            <div className="mt-8 flex flex-col gap-4 rounded-2xl border bg-muted/30 p-4 sm:p-5">
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Course categories"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={filters.category ? 'outline' : 'default'}
                  onClick={() =>
                    setFilters({ ...filters, category: undefined })
                  }
                >
                  All
                </Button>
                {categories.map(({ id, name, slug, courseCount }) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={filters.category === slug ? 'default' : 'outline'}
                    asChild
                  >
                    <Link to="/category/$slug" params={{ slug }}>
                      {name} ({courseCount})
                    </Link>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <CatalogueResults
            filters={filters}
            onFiltersChange={setFilters}
            emptyMessage="Try other filters, or clear them to see every course."
          />
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

      <footer className="border-t px-6 py-8 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 text-sm text-muted-foreground sm:flex-row">
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
