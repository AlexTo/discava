/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@discava/common-shadcn/components/ui/collapsible';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { cn } from '@discava/common-shadcn/lib/utils';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ChevronDown,
  Circle,
  CircleCheck,
  Lock,
  Search,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Alert } from '../../../../components/alert';
import { Spinner } from '../../../../components/spinner';
import {
  type CoursePlayer,
  errorCode,
  type PlayerModule,
  useCoursePlayer,
} from './use-course-player';

export type { CoursePlayer };

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// Why the course can't be shown, with a way on.
function Unavailable({
  courseId,
  error,
}: {
  courseId: string;
  error: unknown;
}) {
  const code = errorCode(error);
  if (code === 'FORBIDDEN') {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-24 text-center lg:px-8">
        <Lock className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Enrol to start learning</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This course's lessons are for enrolled students.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/learn/$courseId" params={{ courseId }}>
            View the course
          </Link>
        </Button>
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-24 text-center lg:px-8">
      {code === 'NOT_FOUND' ? (
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
            {(error as Error | null)?.message ?? 'Something went wrong.'}
          </Alert>
        </div>
      )}
      <Button className="mt-6" asChild>
        <Link to="/">Browse courses</Link>
      </Button>
    </main>
  );
}

/**
 * "Completed ✓", with how many items were added since, e.g. "Completed ✓ ·
 * 2 new items". Completion is permanent, so new content is shown as new rather
 * than undoing it.
 */
export function CompletedWithNew({ count: n }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
        Completed <CircleCheck className="size-3.5" aria-hidden="true" />
      </span>
      {n > 0 ? <span>· {count(n, 'new item', 'new items')}</span> : null}
    </span>
  );
}

// The course's modules and lessons, each lesson ticked once complete. Every
// module starts open; the current lesson is highlighted.
function CourseOutline({
  courseId,
  modules,
  activeLessonId,
  isLessonComplete,
  newItemCount,
}: {
  courseId: string;
  modules: PlayerModule[];
  activeLessonId?: string;
  isLessonComplete: CoursePlayer['isLessonComplete'];
  newItemCount: CoursePlayer['newItemCount'];
}) {
  const [closedModuleIds, setClosedModuleIds] = useState<Set<string>>(
    new Set(),
  );
  const toggle = (moduleId: string) =>
    setClosedModuleIds((current) => {
      const next = new Set(current);
      if (!next.delete(moduleId)) {
        next.add(moduleId);
      }
      return next;
    });

  return (
    <nav aria-label="Course outline" className="space-y-3">
      {modules.map((module, moduleIndex) => {
        const done = module.lessons.filter(isLessonComplete).length;
        const open = !closedModuleIds.has(module.moduleId);
        return (
          <Collapsible
            key={module.moduleId}
            asChild
            open={open}
            onOpenChange={() => toggle(module.moduleId)}
          >
            <Card className="gap-0 overflow-hidden py-0">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                    {moduleIndex + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {module.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {done}/{module.lessons.length} lessons complete
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-muted-foreground transition-transform',
                      open && 'rotate-180',
                    )}
                    aria-hidden="true"
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent asChild>
                <CardContent className="border-t p-0">
                  {module.lessons.map((lesson) => {
                    const active = lesson.lessonId === activeLessonId;
                    const complete = isLessonComplete(lesson);
                    return (
                      <Link
                        key={lesson.lessonId}
                        to="/learn/$courseId/lesson/$lessonId"
                        params={{ courseId, lessonId: lesson.lessonId }}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-b-0 sm:pl-5',
                          active ? 'bg-primary/5' : 'hover:bg-muted/40',
                        )}
                      >
                        {complete ? (
                          <CircleCheck
                            className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-label="Complete"
                          />
                        ) : (
                          <Circle
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            'flex-1 truncate text-sm',
                            active
                              ? 'font-medium text-foreground'
                              : 'text-foreground/90',
                          )}
                        >
                          {lesson.title}
                        </span>
                        {newItemCount(lesson) > 0 ? (
                          <span className="shrink-0 text-xs font-medium text-primary">
                            {newItemCount(lesson)} new
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {count(lesson.contentItems.length, 'item', 'items')}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
    </nav>
  );
}

/**
 * The frame of a course's home and lesson pages for an enrolled student: the
 * course's title and progress over its outline, beside `children(player)`.
 * Shows instead why the course can't be opened: not enrolled, not found, or
 * an error.
 */
export function CoursePlayerLayout({
  courseId,
  activeLessonId,
  children,
}: {
  courseId: string;
  activeLessonId?: string;
  children: (player: CoursePlayer) => ReactNode;
}) {
  const player = useCoursePlayer(courseId);
  const { course, enrolment } = player;

  if (player.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl justify-center px-6 py-24 lg:px-8">
        <Spinner />
      </main>
    );
  }
  if (!course) {
    return <Unavailable courseId={courseId} error={player.error} />;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8">
      <Link
        to="/learn/$courseId"
        params={{ courseId }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Course page
      </Link>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          <Link to="/learn/$courseId/home" params={{ courseId }}>
            {course.title}
          </Link>
        </h1>
        {enrolment ? (
          <div className="w-full max-w-56 space-y-1.5">
            <p className="text-right text-xs text-muted-foreground">
              {enrolment.status === 'completed' ? (
                <CompletedWithNew count={player.newItemIds.size} />
              ) : (
                `${enrolment.progressPercent}% complete`
              )}
            </p>
            <Progress
              value={enrolment.progressPercent}
              aria-label="Course progress"
            />
          </div>
        ) : null}
      </div>

      {player.readOnly ? (
        <div className="mt-6">
          <Alert header="This course is archived">
            You can still review it, but nothing in it can be completed now.
          </Alert>
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_2fr]">
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <CourseOutline
            courseId={courseId}
            modules={course.modules}
            activeLessonId={activeLessonId}
            isLessonComplete={player.isLessonComplete}
            newItemCount={player.newItemCount}
          />
        </aside>
        <section className="min-w-0">{children(player)}</section>
      </div>
    </main>
  );
}
