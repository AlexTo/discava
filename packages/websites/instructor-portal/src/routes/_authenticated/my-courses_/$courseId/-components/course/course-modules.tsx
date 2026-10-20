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
import {
  BookOpen,
  CirclePlus,
  FileText,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { useInstructorApi } from '../../../../../../hooks/useInstructorApi';
import {
  type ContentItem,
  LessonContentItemsRow,
} from '../content-items/lesson-content-items-row';
import { HiddenBadge } from '../hidden-badge';
import { CreateLessonDialog } from '../lesson/create-lesson-dialog';
import { DeleteLessonDialog } from '../lesson/delete-lesson-dialog';
import { EditLessonDialog } from '../lesson/edit-lesson-dialog';
import { CreateModuleDialog } from '../module/create-module-dialog';
import { DeleteModuleDialog } from '../module/delete-module-dialog';
import { EditModuleDialog } from '../module/edit-module-dialog';
import { DragHandle, SortableList } from '../sortable-list';
import { usedItemCount } from '../student-activity';
import {
  LessonVisibilityButton,
  ModuleVisibilityButton,
} from '../visibility-buttons';

type Lesson = {
  lessonId: string;
  title: string;
  description?: string;
  visibility: 'hidden' | 'visible';
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
      renderItem={(lesson, _index, row) => (
        <article
          ref={row?.ref}
          className={cn(
            'border-t first:border-t-0',
            row?.isDragging && 'relative z-10 bg-background shadow-md',
          )}
        >
          <div className="group flex items-center gap-2 px-4 py-2.5 sm:pl-12 sm:pr-5">
            {row && (
              <DragHandle row={row} title={lesson.title} className="-ml-2" />
            )}
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
              <FileText className="size-4" />
            </div>
            <span className="font-medium">{lesson.title}</span>
            {lesson.visibility === 'hidden' && <HiddenBadge />}
            <Badge
              variant="outline"
              className="hidden text-[10px] sm:inline-flex"
            >
              Lesson
            </Badge>
            {!readOnly && (
              <>
                <LessonVisibilityButton
                  courseId={courseId}
                  moduleId={module.moduleId}
                  lessonId={lesson.lessonId}
                  title={lesson.title}
                  visibility={lesson.visibility}
                  draft={draft}
                  className="ml-auto"
                />
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
                <DeleteLessonDialog
                  courseId={courseId}
                  moduleId={module.moduleId}
                  lessonId={lesson.lessonId}
                  title={lesson.title}
                  usedItems={usedItemCount(lesson.contentItems)}
                  archive={archive}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      aria-label={`Remove lesson ${lesson.title}`}
                      className="-ml-2"
                    >
                      <Trash2 />
                    </Button>
                  }
                />
              </>
            )}
          </div>
          <LessonContentItemsRow
            courseId={courseId}
            moduleId={module.moduleId}
            lessonId={lesson.lessonId}
            contentItems={lesson.contentItems}
            archive={archive}
            readOnly={readOnly}
            draft={draft}
          />
        </article>
      )}
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
            ref={row?.ref}
            className={cn(
              'gap-0 overflow-hidden py-0',
              row?.isDragging && 'relative z-10 shadow-lg',
            )}
          >
            <CardHeader className="border-b bg-muted/30 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
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
                <span className="font-semibold">{module.title}</span>
                {module.visibility === 'hidden' && <HiddenBadge />}
                <Badge variant="outline" className="hidden sm:inline-flex">
                  {module.lessons.length}{' '}
                  {module.lessons.length === 1 ? 'lesson' : 'lessons'}
                </Badge>
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
            </CardHeader>
            <CardContent className="p-0">
              {module.lessons.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FileText className="size-5" />
                  </div>
                  <h4 className="mt-1 text-sm font-semibold">No lessons yet</h4>
                  <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                    Lessons hold the content students work through inside this
                    module.
                  </p>
                  {!readOnly && (
                    <CreateLessonDialog
                      courseId={courseId}
                      moduleId={module.moduleId}
                      trigger={
                        <Button className="mt-2" size="sm" type="button">
                          <CirclePlus /> New lesson
                        </Button>
                      }
                    />
                  )}
                </div>
              ) : (
                <>
                  <ModuleLessons {...options} module={module} />
                  {!readOnly && (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-4 py-3 sm:pl-12 sm:pr-5">
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
