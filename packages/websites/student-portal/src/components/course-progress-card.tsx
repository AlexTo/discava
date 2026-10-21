/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { cn } from '@discava/common-shadcn/lib/utils';
import type { IMyEnrolment } from '@discava/core-api';
import { Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// Where a course picks up: its next lesson while in progress, and the course
// home once completed (which leads to anything new).
export function ContinueLink({
  course,
  className,
  size,
}: {
  course: IMyEnrolment;
  className?: string;
  size?: 'default' | 'lg';
}) {
  const { courseId, status, nextLesson, newItemCount } = course;
  const label =
    status === 'completed'
      ? newItemCount > 0
        ? 'See what’s new'
        : 'Review'
      : course.progressPercent > 0
        ? 'Continue'
        : 'Start';
  return (
    <Button className={className} size={size} asChild>
      {status !== 'completed' && nextLesson ? (
        <Link
          to="/learn/$courseId/lesson/$lessonId"
          params={{ courseId, lessonId: nextLesson.lessonId }}
          aria-label={`${label}: ${course.title}`}
        >
          {label}
        </Link>
      ) : (
        <Link
          to="/learn/$courseId/home"
          params={{ courseId }}
          aria-label={`${label}: ${course.title}`}
        >
          {label}
        </Link>
      )}
    </Button>
  );
}

// How far through a course the student is, or that they completed it and
// what's been added since.
export function CourseProgress({ course }: { course: IMyEnrolment }) {
  if (course.status === 'completed') {
    return (
      <p className="flex flex-wrap items-center gap-1 text-sm">
        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
          <CircleCheck className="size-4" aria-hidden="true" /> Completed
        </span>
        {course.newItemCount > 0 ? (
          <span className="text-muted-foreground">
            · {plural(course.newItemCount, 'new item', 'new items')}
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {course.progressPercent}% complete
      </p>
      <Progress
        value={course.progressPercent}
        aria-label={`${course.title} progress`}
      />
    </div>
  );
}

// The lesson a course continues with, e.g. "Up next · Module 2: Vectors ·
// Dot products".
export function UpNext({ course }: { course: IMyEnrolment }) {
  if (course.status === 'completed' || !course.nextLesson) {
    return null;
  }
  const { moduleIndex, moduleTitle, title } = course.nextLesson;
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">
        Up next · Module {moduleIndex + 1}: {moduleTitle} ·{' '}
      </span>
      <span className="font-medium">{title}</span>
    </p>
  );
}

/** One of the student's courses: progress, what's next, and the way in. */
export function CourseProgressCard({
  course,
  className,
}: {
  course: IMyEnrolment;
  className?: string;
}) {
  return (
    <Card className={cn('h-full gap-4 py-5', className)}>
      <CardContent className="flex h-full flex-col gap-4 px-5">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold leading-5">
              <Link
                to="/learn/$courseId/home"
                params={{ courseId: course.courseId }}
                className="hover:underline"
              >
                {course.title}
              </Link>
            </h3>
            {course.courseStatus === 'archived' ? (
              <Badge variant="secondary">Archived</Badge>
            ) : null}
          </div>
          {course.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {course.description}
            </p>
          ) : null}
        </div>
        <UpNext course={course} />
        <div className="mt-auto space-y-4">
          <CourseProgress course={course} />
          <ContinueLink course={course} className="w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
