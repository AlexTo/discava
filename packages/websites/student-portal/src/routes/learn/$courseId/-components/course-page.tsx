/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@discava/common-shadcn/components/ui/collapsible';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ClipboardList,
  FileText,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { useCoreApi } from '../../../../api';
import { CourseThumbnail } from '../../../../components/course-thumbnail';
import { PageBreadcrumbs } from '../../../../components/page-breadcrumbs';
import {
  formatDuration,
  LANGUAGE_LABELS,
  LEVEL_LABELS,
} from '../../../../lib/catalogue-filters';
import { CoursePreview } from './course-preview';
import { EnrolmentActions } from './enrolment-actions';
import { InstructorCard } from './instructor-card';
import { CourseReviews } from './reviews';

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// The sections the tab bar jumps to, in page order, built from the ones the
// page shows: a course without outcomes, requirements or instructors has no
// tab for them.
const sectionsOf = (present: {
  outcomes: boolean;
  requirements: boolean;
  instructors: boolean;
}) => [
  ...(present.outcomes ? [{ id: 'outcomes', label: "What you'll learn" }] : []),
  { id: 'about', label: 'About' },
  ...(present.requirements
    ? [{ id: 'requirements', label: 'Requirements' }]
    : []),
  { id: 'modules', label: 'Modules' },
  ...(present.instructors ? [{ id: 'instructors', label: 'Instructors' }] : []),
  { id: 'reviews', label: 'Reviews' },
];

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
            <h1 className="text-balance mt-4 text-xl font-semibold">
              Course not found
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This course doesn't exist, or may no longer be available.
            </p>
          </>
        ) : (
          <div className="text-left">
            <ErrorAlert type="error" header="Couldn't load this course">
              {apiErrorMessage(courseQuery.error)}
            </ErrorAlert>
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
  const learningOutcomes = course.learningOutcomes ?? [];
  const requirements = course.requirements ?? [];
  const instructors = course.instructors ?? [];
  const sections = sectionsOf({
    outcomes: learningOutcomes.length > 0,
    requirements: requirements.length > 0,
    instructors: instructors.length > 0,
  });
  const lessonCount = modules.reduce(
    (total, module) => total + module.lessons.length,
    0,
  );

  const facts = [
    course.level && {
      label: 'Level',
      value: LEVEL_LABELS[course.level] ?? course.level,
    },
    course.language && {
      label: 'Language',
      value: LANGUAGE_LABELS[course.language] ?? course.language,
    },
    course.durationHours !== undefined && {
      label: 'Estimated time',
      value: formatDuration(course.durationHours),
    },
  ].filter((fact): fact is { label: string; value: string } => !!fact);

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
              <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                {course.title}
              </h1>
              <div className="mt-6 max-w-sm space-y-3">
                <EnrolmentActions
                  courseId={courseId}
                  courseTitle={course.title}
                  priceAmount={course.priceAmount}
                  priceCurrency={course.priceCurrency}
                />
              </div>
            </div>
            {course.preview ? (
              <CoursePreview
                course={course}
                durationSeconds={course.preview.durationSeconds}
              />
            ) : (
              <CourseThumbnail
                course={course}
                className="rounded-xl shadow-sm"
              />
            )}
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
              {facts.map(({ label, value }) => (
                <div key={label} className="px-5 py-4">
                  <p className="font-semibold">{value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{label}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <nav
        aria-label="Course sections"
        className="sticky top-16 z-40 border-b bg-background/95 backdrop-blur"
      >
        <div className="mx-auto flex max-w-5xl gap-1 px-6 lg:px-8">
          {sections.map(({ id, label }) => (
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
        {learningOutcomes.length > 0 ? (
          <section
            id="outcomes"
            aria-labelledby="outcomes-heading"
            className="scroll-mt-32"
          >
            <h2 id="outcomes-heading" className="text-xl font-semibold">
              What you'll learn
            </h2>
            <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {learningOutcomes.map((outcome, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: an outcome has no id, and the list never reorders on this page
                  key={index}
                  className="flex items-start gap-3 text-sm"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span>{outcome}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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

        {requirements.length > 0 ? (
          <section
            id="requirements"
            aria-labelledby="requirements-heading"
            className="scroll-mt-32"
          >
            <h2 id="requirements-heading" className="text-xl font-semibold">
              Requirements
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              {requirements.map((requirement, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a requirement has no id, and the list never reorders on this page
                <li key={index}>{requirement}</li>
              ))}
            </ul>
          </section>
        ) : null}

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
                                {lesson.kind === 'assignment' ? (
                                  <ClipboardList
                                    className="size-4 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-sm">{lesson.title}</span>
                                {lesson.kind === 'assignment' ? (
                                  <span className="text-xs text-muted-foreground">
                                    Assignment
                                  </span>
                                ) : null}
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

        {instructors.length > 0 ? (
          <section
            id="instructors"
            aria-labelledby="instructors-heading"
            className="scroll-mt-32 space-y-4"
          >
            <h2 id="instructors-heading" className="text-xl font-semibold">
              Instructors
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {instructors.map((instructor) => (
                <InstructorCard
                  key={instructor.handle}
                  instructor={instructor}
                />
              ))}
            </div>
          </section>
        ) : null}

        <CourseReviews courseId={courseId} />
      </div>
    </main>
  );
}
