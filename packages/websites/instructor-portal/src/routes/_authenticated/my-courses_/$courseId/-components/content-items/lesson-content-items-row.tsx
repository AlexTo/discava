/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { cn } from '@discava/common-shadcn/lib/utils';
import { Accessibility, defaultPreset } from '@dnd-kit/dom';
import { move } from '@dnd-kit/helpers';
import {
  DragDropProvider,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  GripVertical,
  ListChecks,
  PencilLine,
  Video,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../../../../../../components/alert';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { HiddenBadge } from '../hidden-badge';
import { ContentItemVisibilityButton } from '../visibility-buttons';
import {
  AttachLessonVideoDialog,
  RemoveLessonVideoButton,
} from './attach-lesson-video-dialog';
import {
  EditLessonTextDialog,
  RemoveLessonTextButton,
} from './edit-lesson-text-dialog';
import { QuizBuilderDialog } from './quiz/quiz-builder-dialog';

type ContentItem = {
  contentItemId: string;
  type: string;
  title: string;
  description?: string;
  body?: string;
  status: string;
  visibility: 'hidden' | 'visible';
  studentActivityCount?: number;
  // A quiz's questions, to show how many it has.
  questions?: unknown[];
};

const ROW_CLASS =
  'group/resource flex items-center gap-2 border-l px-3 py-2 transition-colors hover:bg-muted/50';

// One draggable row. The grip is the handle, so the row's own buttons keep
// working; it can also be picked up with the keyboard (Space or Enter, then the
// arrow keys, then Space or Enter to drop, Escape to cancel).
function SortableContentItem({
  id,
  index,
  title,
  disabled,
  children,
}: {
  id: string;
  index: number;
  title: string;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled });

  return (
    <div
      ref={ref}
      className={cn(
        ROW_CLASS,
        isDragging && 'relative z-10 bg-background shadow-md',
      )}
    >
      {children(
        <Button
          ref={handleRef}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Reorder ${title}`}
          disabled={disabled}
          className="-ml-1 cursor-grab touch-none text-muted-foreground hover:bg-transparent hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </Button>,
      )}
    </div>
  );
}

export function LessonContentItemsRow({
  courseId,
  moduleId,
  lessonId,
  contentItems,
  archive,
  readOnly = false,
  draft = false,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItems: ContentItem[];
  // Whether removing a content item archives it (any course but a draft).
  archive: boolean;
  // An archived course can't be edited: no add, edit or remove controls.
  readOnly?: boolean;
  // A draft isn't open to students yet, which changes what Publish/Hide mean.
  draft?: boolean;
}) {
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();
  const reorder = useMutation(contentItem.reorder.mutationOptions());
  const [reorderError, setReorderError] = useState<string>();
  // dnd-kit moves the rows' DOM nodes itself while an item is dragged, so
  // when a save fails, putting the old order back in state isn't enough:
  // React still believes the nodes are where it last put them. Bumping this
  // key rebuilds the list from state instead.
  const [listKey, setListKey] = useState(0);

  // The order shown, which moves as soon as an item is dropped and follows the
  // course view whenever that changes.
  const ids = contentItems.map(({ contentItemId }) => contentItemId);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(ids);
  useEffect(() => setOrder(ids), [idsKey]);
  const byId = useMemo(
    () => new Map(contentItems.map((item) => [item.contentItemId, item])),
    [contentItems],
  );
  const items = order.flatMap((id) => byId.get(id) ?? []);

  // The announcements read the latest titles and order through a ref, so the
  // plugin list below can stay the same object across renders: the provider
  // reconfigures its plugins whenever that list changes, which would rebuild
  // the screen reader plugin mid-drag.
  const latest = useRef({ order, byId });
  latest.current = { order, byId };
  const plugins = useMemo(() => {
    type Source = DragStartEvent['operation']['source'];
    const titleOf = (source: Source) =>
      latest.current.byId.get(String(source?.id))?.title ?? 'item';
    const count = () => latest.current.order.length;
    // Where the dragged item sits (1-based), now or when the drag started.
    const positionOf = (source: Source, initial = false) =>
      isSortable(source)
        ? (initial ? source.initialIndex : source.index) + 1
        : undefined;
    // What a screen reader hears, using titles rather than ids.
    return [
      ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
      Accessibility.configure({
        announcements: {
          dragstart: ({ operation: { source } }: DragStartEvent) =>
            `Picked up ${titleOf(source)}, position ${positionOf(source)} of ${count()}.`,
          dragover: ({ operation: { source } }: DragOverEvent) =>
            `${titleOf(source)} moved to position ${positionOf(source)} of ${count()}.`,
          dragend: ({ operation: { source }, canceled }: DragEndEvent) =>
            canceled
              ? `Moving ${titleOf(source)} was cancelled. It is back at position ${positionOf(source, true)} of ${count()}.`
              : `${titleOf(source)} dropped at position ${positionOf(source)} of ${count()}.`,
        },
      }),
    ];
  }, []);

  const refreshCourse = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });

  // Saves the whole new order in one call. On failure the order snaps back and
  // the course reloads; a CONFLICT means the lesson changed under the editor.
  const onDragEnd = (event: DragEndEvent) => {
    if (event.canceled) {
      return;
    }
    const previous = order;
    const next = move(order, event);
    if (next.join(',') === previous.join(',')) {
      return;
    }
    setOrder(next);
    reorder.mutate(
      { courseId, moduleId, lessonId, contentItemIds: next },
      {
        onError: (error) => {
          setOrder(previous);
          setListKey((key) => key + 1);
          setReorderError(
            error.data?.code === 'CONFLICT'
              ? 'This lesson changed while you were reordering it. It has been reloaded, so try again.'
              : error.message,
          );
        },
        onSettled: () => {
          void refreshCourse();
        },
      },
    );
  };

  // The row's own content, beside its drag handle.
  const renderItem = (item: ContentItem, handle: ReactNode) =>
    item.type === 'quiz' ? (
      <>
        {handle}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
          <ListChecks className="size-3.5" />
        </div>
        <span className="flex-1 truncate text-xs font-medium">
          {item.title}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {item.questions?.length ?? 0}{' '}
          {item.questions?.length === 1 ? 'question' : 'questions'}
        </span>
        {item.visibility === 'hidden' && <HiddenBadge />}
        {!readOnly && (
          <>
            <ContentItemVisibilityButton
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              noun="quiz"
              title={item.title}
              visibility={item.visibility}
              draft={draft}
              className="transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
            />
            <QuizBuilderDialog
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label={`Edit ${item.title}`}
                  className="transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
                >
                  <PencilLine />
                </Button>
              }
            />
            <RemoveLessonTextButton
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              title={item.title}
              archive={archive}
              students={item.studentActivityCount}
              noun="quiz"
            />
          </>
        )}
      </>
    ) : item.type === 'video' ? (
      <>
        {handle}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          <Video className="size-3.5" />
        </div>
        <span className="flex-1 truncate text-xs font-medium">
          {item.title}
        </span>
        {item.visibility === 'hidden' && <HiddenBadge />}
        {!readOnly && (
          <>
            <ContentItemVisibilityButton
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              noun="video"
              title={item.title}
              visibility={item.visibility}
              draft={draft}
              className="transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
            />
            <AttachLessonVideoDialog
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              title={item.title}
              description={item.description}
              status={item.status}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label={`Edit ${item.title}`}
                  className="transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
                >
                  <PencilLine />
                </Button>
              }
            />
            <RemoveLessonVideoButton
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              title={item.title}
              students={item.studentActivityCount}
              archive={archive}
            />
          </>
        )}
      </>
    ) : (
      <>
        {handle}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
          <FileText className="size-3.5" />
        </div>
        <span className="flex-1 truncate text-xs font-medium">
          {item.title}
        </span>
        {item.visibility === 'hidden' && <HiddenBadge />}
        {!readOnly && (
          <>
            <ContentItemVisibilityButton
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              noun="text"
              title={item.title}
              visibility={item.visibility}
              draft={draft}
              className="transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
            />
            <EditLessonTextDialog
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              title={item.title}
              description={item.description}
              body={item.body}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  aria-label={`Edit ${item.title}`}
                  className="transition-opacity sm:opacity-0 sm:group-hover/resource:opacity-100 focus-visible:opacity-100"
                >
                  <PencilLine />
                </Button>
              }
            />
            <RemoveLessonTextButton
              courseId={courseId}
              moduleId={moduleId}
              lessonId={lessonId}
              contentItemId={item.contentItemId}
              title={item.title}
              students={item.studentActivityCount}
              archive={archive}
            />
          </>
        )}
      </>
    );

  return (
    <div className="bg-muted/15 pb-3 pl-12 pr-4 sm:pl-24 sm:pr-5">
      {readOnly || items.length < 2 ? (
        items.map((item) => (
          <div key={item.contentItemId} className={ROW_CLASS}>
            {renderItem(item, null)}
          </div>
        ))
      ) : (
        <DragDropProvider
          key={listKey}
          plugins={plugins}
          onDragStart={() => setReorderError(undefined)}
          onDragEnd={onDragEnd}
        >
          {items.map((item, index) => (
            <SortableContentItem
              key={item.contentItemId}
              id={item.contentItemId}
              index={index}
              title={item.title}
              disabled={reorder.isPending}
            >
              {(handle) => renderItem(item, handle)}
            </SortableContentItem>
          ))}
        </DragDropProvider>
      )}
      {reorderError && (
        <div className="border-l px-3 pt-2">
          <Alert type="error" header="Couldn't reorder the content">
            {reorderError}
          </Alert>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 border-l px-3 pt-2">
          <AttachLessonVideoDialog
            courseId={courseId}
            moduleId={moduleId}
            lessonId={lessonId}
            trigger={
              <Button variant="outline" size="sm" type="button">
                <Video /> Video
              </Button>
            }
          />
          <EditLessonTextDialog
            courseId={courseId}
            moduleId={moduleId}
            lessonId={lessonId}
            trigger={
              <Button variant="outline" size="sm" type="button">
                <FileText /> Text
              </Button>
            }
          />
          <QuizBuilderDialog
            courseId={courseId}
            moduleId={moduleId}
            lessonId={lessonId}
            trigger={
              <Button variant="outline" size="sm" type="button">
                <ListChecks /> Quiz
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
