/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
} from '@discava/common-shadcn/components/ui/card';
import { cn } from '@discava/common-shadcn/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BookOpen,
  CirclePlus,
  ClipboardCheck,
  FileText,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { useInstructorApi } from '../../../../../../api';
import { CreateAssignmentDialog } from '../assignment/create-assignment-dialog';
import { EditAssignmentDialog } from '../assignment/edit-assignment-dialog';
import {
  type ContentItem,
  LessonContentItemsRow,
} from '../content-items/lesson-content-items-row';
import { QuizBuilderDialog } from '../content-items/quiz/quiz-builder-dialog';
import { HiddenBadge } from '../hidden-badge';
import { CreateLessonDialog } from '../lesson/create-lesson-dialog';
import { DeleteLessonDialog } from '../lesson/delete-lesson-dialog';
import { EditLessonDialog } from '../lesson/edit-lesson-dialog';
import { FreePreviewBadge } from '../lesson/free-preview-badge';
import { FreePreviewButton } from '../lesson/free-preview-button';
import { CreateModuleDialog } from '../module/create-module-dialog';
import { DeleteModuleDialog } from '../module/delete-module-dialog';
import { EditModuleDialog } from '../module/edit-module-dialog';
import { DragHandle, SortableList } from '../sortable-list';
import { usedItemCount } from '../student-activity';
import { useFocusAfterRemoval } from '../use-focus-after-removal';
import {
  LessonVisibilityButton,
  ModuleVisibilityButton,
} from '../visibility-buttons';

type Lesson = {
  lessonId: string;
  // An assignment is a lesson holding one quiz or upload assignment (#102).
  kind: 'lesson' | 'assignment';
  title: string;
  description?: string;
  visibility: 'hidden' | 'visible';
  // Set by an instructor on an ordinary lesson; not the same as being open.
  freePreview?: boolean;
  archivedAt?: string;
  contentItems: ContentItem[];
};

type Module = {
  moduleId: string;
  title: string;
  description?: string;
  visibility: 'hidden' | 'visible';
  lessons: Lesson[];
};

type Options = {
  courseId: string;
  // Whether removing a module or lesson archives it (any course but a draft).
  archive: boolean;
  // An archived course can't be edited: no add, edit, remove or reorder.
  readOnly: boolean;
  // A draft isn't open to students yet, which changes what Publish/Hide mean.
  draft: boolean;
};

const useRefreshCourse = (courseId: string) => {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
};

// A module's lessons, which the instructor drags by their grips to reorder
// within the module. Moving a lesson to another module isn't supported.
function ModuleLessons({
  courseId,
  module,
  archive,
  readOnly,
  draft,
}: Options & { module: Module }) {
  const { lesson: lessonApi } = useInstructorApi();
  const reorder = useMutation(lessonApi.reorder.mutationOptions());
  const refreshCourse = useRefreshCourse(courseId);
  // Marked lessons are open to anyone only in a published course.
  const published = !draft && !readOnly;
  const { register } = useFocusAfterRemoval(
    module.lessons.map((lesson) => lesson.lessonId),
    () => document.getElementById('content-heading'),
  );

  return (
    <SortableList
      items={module.lessons}
      getId={(lesson) => lesson.lessonId}
      getTitle={(lesson) => lesson.title}
      sortable={!readOnly}
      // The course reloads either way; a CONFLICT means the module changed
      // under the editor.
      save={(lessonIds) =>
        reorder
          .mutateAsync({ courseId, moduleId: module.moduleId, lessonIds })
          .finally(() => void refreshCourse())
      }
      errorHeader="Couldn't reorder the lessons"
      conflictMessage="This module changed while you were reordering its lessons. It has been reloaded, so try again."
      errorClassName="border-t px-4 py-3 sm:pl-12 sm:pr-5"
      renderItem={(lesson, _index, row) => {
        const isAssignment = lesson.kind === 'assignment';
        const noun = isAssignment ? 'assignment' : 'lesson';
        // An assignment's one item is edited from its row, never added to.
        const item = lesson.contentItems[0];
        return (
          <article
            ref={(element) => {
              row?.ref(element);
              register(lesson.lessonId)(element);
            }}
            className={cn(
              'border-t first:border-t-0',
              row?.isDragging && 'relative z-10 bg-background shadow-md',
            )}
          >
            <div className="group flex flex-wrap items-center gap-2 px-4 py-2.5 sm:pl-12 sm:pr-5">
              {row && (
                <DragHandle row={row} title={lesson.title} className="-ml-2" />
              )}
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                {isAssignment ? (
                  <ClipboardCheck className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
              </div>
              <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 break-words sm:basis-0 sm:flex-1">
                <span className="min-w-0 font-medium break-words">
                  {lesson.title}
                </span>
                {lesson.visibility === 'hidden' && <HiddenBadge />}
                {lesson.freePreview === true && (
                  <FreePreviewBadge
                    open={
                      published &&
                      module.visibility === 'visible' &&
                      lesson.visibility === 'visible'
                    }
                  />
                )}
                <Badge
                  variant="outline"
                  className="hidden text-[10px] sm:inline-flex"
                >
                  {isAssignment ? 'Assignment' : 'Lesson'}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {isAssignment && item && item.type !== 'quiz' && (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to="/my-courses/$courseId/assignments/$contentItemId/submissions"
                      params={{ courseId, contentItemId: item.contentItemId }}
                      aria-label={`Submissions for ${lesson.title}`}
                    >
                      Submissions
                    </Link>
                  </Button>
                )}
                {!readOnly && (
                  <>
                    <LessonVisibilityButton
                      courseId={courseId}
                      moduleId={module.moduleId}
                      lessonId={lesson.lessonId}
                      title={lesson.title}
                      visibility={lesson.visibility}
                      draft={draft}
                      noun={noun}
                      className="ml-auto"
                    />
                    {!isAssignment && !lesson.archivedAt && (
                      <FreePreviewButton
                        courseId={courseId}
                        moduleId={module.moduleId}
                        lessonId={lesson.lessonId}
                        title={lesson.title}
                        freePreview={lesson.freePreview === true}
                      />
                    )}
                    {isAssignment ? (
                      item &&
                      (item.type === 'quiz' ? (
                        <QuizBuilderDialog
                          courseId={courseId}
                          moduleId={module.moduleId}
                          lessonId={lesson.lessonId}
                          contentItemId={item.contentItemId}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              type="button"
                              aria-label={`Edit assignment ${lesson.title}`}
                              className="-ml-2"
                            >
                              <PencilLine />
                            </Button>
                          }
                        />
                      ) : (
                        <EditAssignmentDialog
                          courseId={courseId}
                          moduleId={module.moduleId}
                          lessonId={lesson.lessonId}
                          contentItemId={item.contentItemId}
                          title={lesson.title}
                          body={item.body}
                          maxPoints={item.maxPoints}
                          dueAt={item.dueAt}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              type="button"
                              aria-label={`Edit assignment ${lesson.title}`}
                              className="-ml-2"
                            >
                              <PencilLine />
                            </Button>
                          }
                        />
                      ))
                    ) : (
                      <EditLessonDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        lessonId={lesson.lessonId}
                        title={lesson.title}
                        description={lesson.description}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            type="button"
                            aria-label={`Edit lesson ${lesson.title}`}
                            className="-ml-2"
                          >
                            <PencilLine />
                          </Button>
                        }
                      />
                    )}
                    <DeleteLessonDialog
                      courseId={courseId}
                      moduleId={module.moduleId}
                      lessonId={lesson.lessonId}
                      title={lesson.title}
                      usedItems={usedItemCount(lesson.contentItems)}
                      archive={archive}
                      noun={noun}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          aria-label={`Remove ${noun} ${lesson.title}`}
                          className="-ml-2"
                        >
                          <Trash2 />
                        </Button>
                      }
                    />
                  </>
                )}
              </div>
            </div>
            {!isAssignment && (
              <LessonContentItemsRow
                courseId={courseId}
                moduleId={module.moduleId}
                lessonId={lesson.lessonId}
                contentItems={lesson.contentItems}
                archive={archive}
                readOnly={readOnly}
                draft={draft}
              />
            )}
          </article>
        );
      }}
    />
  );
}

// The course's modules, which the instructor drags by their grips to reorder,
// each with its lessons.
export function CourseModules({
  modules,
  ...options
}: Options & { modules: Module[] }) {
  const { courseId, archive, readOnly, draft } = options;
  const { module: moduleApi } = useInstructorApi();
  const reorder = useMutation(moduleApi.reorder.mutationOptions());
  const refreshCourse = useRefreshCourse(courseId);
  const { register } = useFocusAfterRemoval(
    modules.map((module) => module.moduleId),
    () => document.getElementById('content-heading'),
  );

  if (modules.length === 0) {
    return (
      <Card className="border-dashed py-14 text-center">
        <CardContent>
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <BookOpen className="size-6" />
          </div>
          <h3 className="mt-5 text-lg font-semibold">
            Start with your first module
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Modules are the top-level sections of a course. Lessons live inside
            them.
          </p>
          {!readOnly && (
            <CreateModuleDialog
              courseId={courseId}
              trigger={
                <Button className="mt-5" type="button">
                  <CirclePlus /> New module
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SortableList
        items={modules}
        getId={(module) => module.moduleId}
        getTitle={(module) => module.title}
        sortable={!readOnly}
        // The course reloads either way; a CONFLICT means the course changed
        // under the editor.
        save={(moduleIds) =>
          reorder
            .mutateAsync({ courseId, moduleIds })
            .finally(() => void refreshCourse())
        }
        errorHeader="Couldn't reorder the modules"
        conflictMessage="This course changed while you were reordering its modules. It has been reloaded, so try again."
        renderItem={(module, moduleIndex, row) => (
          <Card
            ref={(element) => {
              row?.ref(element);
              register(module.moduleId)(element);
            }}
            className={cn(
              'gap-0 overflow-hidden py-0',
              row?.isDragging && 'relative z-10 shadow-lg',
            )}
          >
            <CardHeader className="border-b bg-muted/30 px-4 py-3 sm:px-5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {row && (
                  <DragHandle
                    row={row}
                    title={module.title}
                    className="-ml-2"
                  />
                )}
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-xs font-semibold shadow-xs">
                  {moduleIndex + 1}
                </span>
                <div className="flex min-w-0 basis-full flex-wrap items-center gap-2 break-words sm:basis-0 sm:flex-1">
                  <span className="min-w-0 font-semibold break-words">
                    {module.title}
                  </span>
                  {module.visibility === 'hidden' && <HiddenBadge />}
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {module.lessons.length}{' '}
                    {module.lessons.length === 1 ? 'lesson' : 'lessons'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {!readOnly && (
                    <>
                      <ModuleVisibilityButton
                        courseId={courseId}
                        moduleId={module.moduleId}
                        title={module.title}
                        visibility={module.visibility}
                        draft={draft}
                        className="ml-auto"
                      />
                      <EditModuleDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        title={module.title}
                        description={module.description}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            type="button"
                            aria-label={`Edit module ${moduleIndex + 1}`}
                            className="-ml-2"
                          >
                            <PencilLine />
                          </Button>
                        }
                      />
                      <DeleteModuleDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        title={module.title}
                        lessonCount={module.lessons.length}
                        usedItems={module.lessons.reduce(
                          (count, lesson) =>
                            count + usedItemCount(lesson.contentItems),
                          0,
                        )}
                        archive={archive}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            type="button"
                            aria-label={`Remove module ${moduleIndex + 1}`}
                            className="-ml-2"
                          >
                            <Trash2 />
                          </Button>
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {module.lessons.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FileText className="size-5" />
                  </div>
                  <h3 className="mt-1 text-sm font-semibold">No lessons yet</h3>
                  <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                    Lessons hold the content students work through inside this
                    module.
                  </p>
                  {!readOnly && (
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <CreateLessonDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        trigger={
                          <Button size="sm" type="button">
                            <CirclePlus /> New lesson
                          </Button>
                        }
                      />
                      <CreateAssignmentDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        trigger={
                          <Button variant="outline" size="sm" type="button">
                            <ClipboardCheck /> New assignment
                          </Button>
                        }
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <ModuleLessons {...options} module={module} />
                  {!readOnly && (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-4 py-3 sm:pl-12 sm:pr-5">
                      <CreateAssignmentDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        trigger={
                          <Button variant="outline" size="sm" type="button">
                            <ClipboardCheck /> New assignment
                          </Button>
                        }
                      />
                      <CreateLessonDialog
                        courseId={courseId}
                        moduleId={module.moduleId}
                        trigger={
                          <Button variant="outline" size="sm" type="button">
                            <FileText /> New lesson
                          </Button>
                        }
                      />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      />
      {!readOnly && (
        <div className="flex justify-end">
          <CreateModuleDialog
            courseId={courseId}
            trigger={
              <Button type="button" variant="outline">
                <CirclePlus /> New module
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
