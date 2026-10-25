/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@discava/common-shadcn/components/ui/collapsible';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, FileText, Search } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../../../components/alert';
import { CourseThumbnail } from '../../../../components/course-thumbnail';
import { PageBreadcrumbs } from '../../../../components/page-breadcrumbs';
import { Spinner } from '../../../../components/spinner';
import { useCoreApi } from '../../../../hooks/useCoreApi';
import { EnrolmentActions } from './enrolment-actions';

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// The sections the tab bar jumps to, in page order.
const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'modules', label: 'Modules' },
] as const;

// A course's page, as on Coursera's /learn/<course>: a header with the
// course's title and the enrolment action, a strip of key facts, then a tab
// bar that stays in view and jumps to each section (the description is in
// About). Everyone sees the same page;
// only the enrolment action depends on who is looking.
export function CoursePage({ courseId }: { courseId: string }) {
  const trpc = useCoreApi();
  const courseQuery = useQuery(
    trpc.course.publicView.queryOptions({ courseId }),
  );
  const [expandedModuleId, setExpandedModuleId] = useState<string>();

  if (courseQuery.isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-3xl justify-center px-6 py-24 lg:px-8">
        <Spinner />
      </main>
    );
  }

  if (courseQuery.isError || !courseQuery.data) {
    const notFound =
      (courseQuery.error as { data?: { code?: string } } | undefined)?.data
        ?.code === 'NOT_FOUND';

    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-24 text-center lg:px-8">
        {notFound ? (
          <>
            <Search className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 text-xl font-semibold">Course not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This course doesn't exist, or may no longer be available.
            </p>
          </>
        ) : (
          <div className="text-left">
            <Alert type="error" header="Couldn't load this course">
              {apiErrorMessage(courseQuery.error)}
            </Alert>
          </div>
        )}
        <Button className="mt-6" asChild>
          <Link to="/">Browse courses</Link>
        </Button>
      </main>
    );
  }

  const course = courseQuery.data;
  const { modules } = course;
  const lessonCount = modules.reduce(
    (total, module) => total + module.lessons.length,
    0,
  );

  return (
    <main className="w-full">
      <section className="border-b bg-muted/40">
        <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
          <PageBreadcrumbs
            crumbs={[{ label: course.title }]}
            className="mb-6"
          />
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {course.title}
              </h1>
              <div className="mt-6 max-w-sm space-y-3">
                <EnrolmentActions
                  courseId={courseId}
                  courseTitle={course.title}
                />
              </div>
            </div>
            <CourseThumbnail course={course} className="rounded-xl shadow-sm" />
          </div>
          <Card className="mt-8 py-0 shadow-sm">
            <CardContent className="grid divide-y p-0 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <a
                href="#modules"
                className="px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <p className="font-semibold underline-offset-4 hover:underline">
                  {count(modules.length, 'module', 'modules')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Work through them in order, at your own pace.
                </p>
              </a>
              <div className="px-5 py-4">
                <p className="font-semibold">
                  {count(lessonCount, 'lesson', 'lessons')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Across {count(modules.length, 'module', 'modules')}.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <nav
        aria-label="Course sections"
        className="sticky top-16 z-40 border-b bg-background/95 backdrop-blur"
      >
        <div className="mx-auto flex max-w-5xl gap-1 px-6 lg:px-8">
          {SECTIONS.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-5xl space-y-12 px-6 py-10 lg:px-8">
        <section
          id="about"
          aria-labelledby="about-heading"
          className="scroll-mt-32"
        >
          <h2 id="about-heading" className="text-xl font-semibold">
            About this course
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            {course.description ||
              "The instructor hasn't described this course yet."}
          </p>
        </section>

        <section
          id="modules"
          aria-labelledby="modules-heading"
          className="scroll-mt-32 space-y-4"
        >
          <h2 id="modules-heading" className="text-xl font-semibold">
            {modules.length === 1
              ? 'There is 1 module in this course'
              : `There are ${modules.length} modules in this course`}
          </h2>
          <div className="space-y-3">
            {modules.map((module, moduleIndex) => {
              const isExpanded = expandedModuleId
                ? expandedModuleId === module.moduleId
                : moduleIndex === 0;
              return (
                <Collapsible
                  key={module.moduleId}
                  asChild
                  open={isExpanded}
                  onOpenChange={(open) =>
                    setExpandedModuleId(open ? module.moduleId : undefined)
                  }
                >
                  <Card className="gap-0 overflow-hidden py-0">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-muted/40 sm:px-5"
                      >
                        <span className="flex flex-col">
                          <span className="font-semibold">{module.title}</span>
                          <span className="text-sm text-muted-foreground">
                            Module {moduleIndex + 1} &middot;{' '}
                            {count(module.lessons.length, 'lesson', 'lessons')}
                          </span>
                        </span>
                        <ChevronDown
                          className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent asChild>
                      <CardContent className="border-t p-0">
                        {module.lessons.length === 0 ? (
                          <p className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
                            No lessons yet.
                          </p>
                        ) : (
                          <ol>
                            {module.lessons.map((lesson) => (
                              <li
                                key={lesson.lessonId}
                                className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 sm:px-5"
                              >
                                <FileText className="size-4 shrink-0 text-muted-foreground" />
                                <span className="text-sm">{lesson.title}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
          {modules.length === 0 ? (
            <Badge variant="secondary">Content is on its way</Badge>
          ) : null}
        </section>
      </div>
    </main>
  );
}
