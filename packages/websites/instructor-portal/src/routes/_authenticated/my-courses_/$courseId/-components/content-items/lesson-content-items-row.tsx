/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { cn } from '@discava/common-shadcn/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, ListChecks, PencilLine, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import { HiddenBadge } from '../hidden-badge';
import { DragHandle, SortableList } from '../sortable-list';
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

export type ContentItem = {
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

  const refreshCourse = () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });

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
      <SortableList
        items={contentItems}
        getId={(item) => item.contentItemId}
        getTitle={(item) => item.title}
        sortable={!readOnly}
        // The course reloads either way; a CONFLICT means the lesson changed
        // under the editor.
        save={(contentItemIds) =>
          reorder
            .mutateAsync({ courseId, moduleId, lessonId, contentItemIds })
            .finally(() => void refreshCourse())
        }
        errorHeader="Couldn't reorder the content"
        conflictMessage="This lesson changed while you were reordering it. It has been reloaded, so try again."
        errorClassName="border-l px-3 pt-2"
        renderItem={(item, _index, row) => (
          <div
            ref={row?.ref}
            className={cn(
              ROW_CLASS,
              row?.isDragging && 'relative z-10 bg-background shadow-md',
            )}
          >
            {renderItem(
              item,
              row && (
                <DragHandle
                  row={row}
                  title={item.title}
                  size="xs"
                  className="-ml-1"
                />
              ),
            )}
          </div>
        )}
      />
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
