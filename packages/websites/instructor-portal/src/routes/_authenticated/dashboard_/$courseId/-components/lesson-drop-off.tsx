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

export interface ModuleWithoutQuestions {
  moduleId: string;
  title: string;
}

// The lessons with the lowest share among those anyone started. Marked only
// when at least two lessons have a share to compare and they don't all match
// (a course with no drop-off has no lowest).
const lowestShare = (lessons: LessonFigures[]): Set<string> => {
  const shares = lessons.flatMap(({ completionShare }) =>
    completionShare === null ? [] : [completionShare],
  );
  if (shares.length < 2) {
    return new Set();
  }
  const lowest = Math.min(...shares);
  if (shares.every((share) => share === lowest)) {
    return new Set();
  }
  return new Set(
    lessons
      .filter(({ completionShare }) => completionShare === lowest)
      .map(({ lessonId }) => lessonId),
  );
};

// One bar per lesson, in course order, of the share of those who started it
// who completed it. The numbers are always shown.
export function LessonDropOff({
  lessons,
  modulesWithoutQuestions = [],
}: {
  lessons: LessonFigures[];
  modulesWithoutQuestions?: ModuleWithoutQuestions[];
}) {
  const lowest = lowestShare(lessons);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base" role="heading" aria-level={2}>
          Lesson drop-off
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Of the learners who started each lesson, the share who completed it.
        </p>
        {modulesWithoutQuestions.length > 0 && (
          <p className="text-sm text-muted-foreground">
            These modules have video and no questions:{' '}
            {modulesWithoutQuestions.map(({ title }) => title).join(', ')}.
            Learners remember more when a video asks them something.
          </p>
        )}
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
                  className="group rounded-md p-2 hover:bg-muted"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere] font-medium">
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
                  <p className="mt-1 text-xs text-muted-foreground">
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
