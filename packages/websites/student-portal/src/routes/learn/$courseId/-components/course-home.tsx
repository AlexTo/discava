/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card, CardContent } from '@discava/common-shadcn/components/ui/card';
import { Link } from '@tanstack/react-router';
import { BookOpen, CircleCheck } from 'lucide-react';
import { type CoursePlayer, CoursePlayerLayout } from './course-player';

function NextUp({
  courseId,
  player,
}: {
  courseId: string;
  player: CoursePlayer;
}) {
  const { lessons, nextLesson, isLessonComplete, enrolment, newItemIds } =
    player;

  if (!nextLesson) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <BookOpen className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">No lessons yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your instructor hasn't published any lessons in this course yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const allDone = lessons.every(({ lesson }) => isLessonComplete(lesson));
  const started =
    allDone || lessons.some(({ lesson }) => isLessonComplete(lesson));
  // Everything done, but content was added since: pick up there.
  const hasNew = allDone && newItemIds.size > 0;
  const { module, moduleIndex, lesson } = nextLesson;
  return (
    <Card className="border-primary/20">
      <CardContent className="space-y-4">
        {allDone || enrolment?.status === 'completed' ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="size-4" /> You've completed this course
            </span>
            {newItemIds.size > 0 ? (
              <span className="text-muted-foreground">
                ·{' '}
                {newItemIds.size === 1
                  ? '1 new item'
                  : `${newItemIds.size} new items`}{' '}
                added since
              </span>
            ) : null}
          </p>
        ) : null}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {hasNew
              ? 'New content'
              : allDone
                ? 'Review'
                : started
                  ? 'Up next'
                  : 'Start here'}{' '}
            · Module {moduleIndex + 1}: {module.title}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{lesson.title}</h2>
          {lesson.description ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {lesson.description}
            </p>
          ) : null}
        </div>
        <Button asChild>
          <Link
            to="/learn/$courseId/lesson/$lessonId"
            params={{ courseId, lessonId: lesson.lessonId }}
          >
            {hasNew
              ? 'See what’s new'
              : allDone
                ? 'Review'
                : started
                  ? 'Continue'
                  : 'Start'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// A course's own home: its outline, and where to pick up.
export function CourseHome({ courseId }: { courseId: string }) {
  return (
    <CoursePlayerLayout courseId={courseId}>
      {(player) => (
        <div className="space-y-6">
          <NextUp courseId={courseId} player={player} />
          {player.course?.description ? (
            <div>
              <h2 className="text-sm font-semibold">About this course</h2>
              <p className="mt-1.5 leading-7 text-muted-foreground">
                {player.course.description}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </CoursePlayerLayout>
  );
}
