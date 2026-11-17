/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';

export interface LessonFigures {
  lessonId: string;
  title: string;
  started: number;
  completed: number;
  completionShare: number | null;
}

// The lessons with the lowest share among those anyone started. Marked only
// when at least two lessons have a share to compare.
const lowestShare = (lessons: LessonFigures[]): Set<string> => {
  const shares = lessons.flatMap(({ completionShare }) =>
    completionShare === null ? [] : [completionShare],
  );
  if (shares.length < 2) {
    return new Set();
  }
  const lowest = Math.min(...shares);
  return new Set(
    lessons
      .filter(({ completionShare }) => completionShare === lowest)
      .map(({ lessonId }) => lessonId),
  );
};

// One bar per lesson, in course order, of the share of those who started it
// who completed it. The numbers show on hover or focus, and are always there
// for assistive technology.
export function LessonDropOff({ lessons }: { lessons: LessonFigures[] }) {
  const lowest = lowestShare(lessons);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          Lesson drop-off
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Of the learners who started each lesson, the share who completed it.
        </p>
      </CardHeader>
      <CardContent>
        {lessons.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No lessons are shown to learners yet.
          </p>
        ) : (
          <ol className="space-y-1" aria-label="Lessons in course order">
            {lessons.map((lesson) => {
              const share = lesson.completionShare;
              return (
                <li
                  key={lesson.lessonId}
                  tabIndex={0}
                  className="group rounded-md p-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">
                      {lesson.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {lowest.has(lesson.lessonId) && (
                        <Badge variant="destructive">Lowest completion</Badge>
                      )}
                      <span className="tabular-nums">
                        {share === null ? 'No data' : `${share}%`}
                      </span>
                    </span>
                  </div>
                  <div
                    className="mt-1 h-2 rounded-full bg-muted group-hover:bg-background"
                    aria-hidden="true"
                  >
                    <div
                      className="h-2 rounded-full bg-[var(--chart-1)]"
                      style={{ width: `${share ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                    {lesson.started === 0
                      ? 'Nobody has started this lesson'
                      : `${lesson.started} started, ${lesson.completed} completed`}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
