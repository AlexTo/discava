/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { cn } from '@discava/common-shadcn/lib/utils';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  FileX,
} from 'lucide-react';
import { Fragment } from 'react';
import { ContentItem, ITEM_TYPES, itemAnchor } from './content-item';
import {
  CompletedWithNew,
  type CoursePlayer,
  CoursePlayerLayout,
} from './course-player';
import { useQuizFailed } from './quiz-item';
import type { PlayerItem } from './use-course-player';

// One item as a step: ✓ done, ⚠ a quiz finished without passing, or the
// item's type. It scrolls to the item on this page.
function Step({
  item,
  index,
  done,
  isNew,
}: {
  item: PlayerItem;
  index: number;
  done: boolean;
  isNew: boolean;
}) {
  const failed = useQuizFailed(item) && done;
  const Icon = failed
    ? AlertTriangle
    : done
      ? CircleCheck
      : ITEM_TYPES[item.type].icon;
  return (
    <li>
      <a
        href={`#${itemAnchor(item.contentItemId)}`}
        onClick={(event) => {
          event.preventDefault();
          document
            .getElementById(itemAnchor(item.contentItemId))
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted/60',
          failed
            ? 'border-amber-500/50 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
            : done &&
                'border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="sr-only">
          Step {index + 1}
          {failed ? ', finished but not passed' : done ? ', done' : ''}
          {isNew ? ', new' : ''}:{' '}
        </span>
        <span className="max-w-40 truncate">{item.title}</span>
        {isNew ? (
          <span aria-hidden="true" className="font-semibold text-primary">
            New
          </span>
        ) : null}
      </a>
    </li>
  );
}

// The lesson's items as steps. A failed quiz never blocks moving on.
function StepBar({
  items,
  completedItemIds,
  newItemIds,
}: {
  items: PlayerItem[];
  completedItemIds: Set<string>;
  newItemIds: Set<string>;
}) {
  return (
    <nav aria-label="Lesson steps">
      <ol className="flex flex-wrap gap-2">
        {items.map((item, index) => (
          <Step
            key={item.contentItemId}
            item={item}
            index={index}
            done={completedItemIds.has(item.contentItemId)}
            isNew={newItemIds.has(item.contentItemId)}
          />
        ))}
      </ol>
    </nav>
  );
}

function Lesson({
  courseId,
  lessonId,
  player,
}: {
  courseId: string;
  lessonId: string;
  player: CoursePlayer;
}) {
  const {
    lessons,
    completedItemIds,
    newItemIds,
    isLessonComplete,
    newItemCount,
    readOnly,
  } = player;
  const index = lessons.findIndex(({ lesson }) => lesson.lessonId === lessonId);

  // Hidden, archived or deleted by the instructor (or never in this course):
  // course.view lists only what a student may see.
  if (index === -1) {
    return (
      <div className="py-16 text-center">
        <FileX className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">
          This lesson has been removed by your instructor
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          It's no longer part of this course.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/learn/$courseId/home" params={{ courseId }}>
            Back to the course
          </Link>
        </Button>
      </div>
    );
  }

  const { module, moduleIndex, lesson } = lessons[index];
  const previous = lessons[index - 1];
  const next = lessons[index + 1];
  const items = lesson.contentItems;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          Module {moduleIndex + 1}: {module.title}
        </p>
        <h2 className="text-2xl font-semibold">{lesson.title}</h2>
        {isLessonComplete(lesson) && newItemCount(lesson) > 0 ? (
          <p className="text-sm text-muted-foreground">
            <CompletedWithNew count={newItemCount(lesson)} />
          </p>
        ) : null}
        {lesson.description ? (
          <p className="text-muted-foreground">{lesson.description}</p>
        ) : null}
        {items.length > 1 ? (
          <StepBar
            items={items}
            completedItemIds={completedItemIds}
            newItemIds={newItemIds}
          />
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There's nothing in this lesson yet.
        </p>
      ) : (
        items.map((item, itemIndex) => (
          <Fragment key={item.contentItemId}>
            {itemIndex > 0 ? <hr /> : null}
            <ContentItem
              item={item}
              done={completedItemIds.has(item.contentItemId)}
              isNew={newItemIds.has(item.contentItemId)}
              readOnly={readOnly}
            />
          </Fragment>
        ))
      )}

      <nav
        aria-label="Lessons"
        className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
      >
        {previous ? (
          <Button variant="outline" asChild>
            <Link
              to="/learn/$courseId/lesson/$lessonId"
              params={{ courseId, lessonId: previous.lesson.lessonId }}
            >
              <ArrowLeft className="size-4" /> Previous lesson
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button asChild>
            <Link
              to="/learn/$courseId/lesson/$lessonId"
              params={{ courseId, lessonId: next.lesson.lessonId }}
            >
              Next lesson <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link to="/learn/$courseId/home" params={{ courseId }}>
              Back to the course
            </Link>
          </Button>
        )}
      </nav>
    </div>
  );
}

// One lesson of a course: all its items on one scrolling page.
export function LessonPage({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  return (
    <CoursePlayerLayout courseId={courseId} activeLessonId={lessonId}>
      {(player) => (
        <Lesson courseId={courseId} lessonId={lessonId} player={player} />
      )}
    </CoursePlayerLayout>
  );
}
