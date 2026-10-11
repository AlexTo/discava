/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlertDescription,
  Alert as ShadcnAlert,
} from '@discava/common-shadcn/components/ui/alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
} from '@discava/common-shadcn/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  CirclePlus,
  FileText,
  GripVertical,
  Info,
  PencilLine,
  Trash2,
} from 'lucide-react';
import { useBreadcrumbLabel } from '../../../../components/AppLayout/breadcrumb-label';
import { Alert } from '../../../../components/alert';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../../../components/course-status';
import { Spinner } from '../../../../components/spinner';
import { useInstructorApi } from '../../../../hooks/useInstructorApi';
import { LessonContentItemsRow } from './-components/content-items/lesson-content-items-row';
import { ArchivedSection } from './-components/course/archived-section';
import { CourseStatusActions } from './-components/course/course-status-actions';
import { HiddenBadge } from './-components/hidden-badge';
import { CreateLessonDialog } from './-components/lesson/create-lesson-dialog';
import { DeleteLessonDialog } from './-components/lesson/delete-lesson-dialog';
import { EditLessonDialog } from './-components/lesson/edit-lesson-dialog';
import { CreateModuleDialog } from './-components/module/create-module-dialog';
import { DeleteModuleDialog } from './-components/module/delete-module-dialog';
import { EditModuleDialog } from './-components/module/edit-module-dialog';
import { usedItemCount } from './-components/student-activity';
import {
  LessonVisibilityButton,
  ModuleVisibilityButton,
} from './-components/visibility-buttons';

export const Route = createFileRoute('/_authenticated/my-courses_/$courseId')({
  component: RouteComponent,
});

const courseStatusLabels: Record<string, CourseStatus> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

const withoutArchived = <
  T extends {
    modules: (M & {
      archivedAt?: string;
      lessons: (L & {
        archivedAt?: string;
        contentItems: (C & { archivedAt?: string })[];
      })[];
    })[];
  },
  M,
  L,
  C,
>(
  course: T,
): T => ({
  ...course,
  modules: course.modules
    .filter((module) => !module.archivedAt)
    .map((module) => ({
      ...module,
      lessons: module.lessons
        .filter((lesson) => !lesson.archivedAt)
        .map((lesson) => ({
          ...lesson,
          contentItems: lesson.contentItems.filter((item) => !item.archivedAt),
        })),
    })),
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  const trpc = useInstructorApi();
  const {
    isPending,
    isError,
    error,
    data: fullCourse,
  } = useQuery(trpc.course.view.queryOptions({ courseId }));

  useBreadcrumbLabel(fullCourse?.title);

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    const notFound = error.data?.code === 'NOT_FOUND';
    return (
      <Alert
        type="error"
        header={notFound ? 'Course not found' : "Couldn't load this course"}
      >
        {notFound
          ? "This course doesn't exist, or you don't have access to it."
          : error.message}
      </Alert>
    );
  }
  // Archived records move out of the editor into the Archived section below;
  // students' data for them is kept and they can be restored from there.
  const course = withoutArchived(fullCourse);
  const status = courseStatusLabels[course.status] ?? 'Draft';
  // Outside a draft course, delete archives instead of destroying anything.
  const archiveOnDelete = course.status !== 'draft';
  // An archived course is read-only until it's restored.
  const readOnly = course.status === 'archived';
  // A draft isn't open to students yet, which changes what Publish/Hide mean.
  const draft = course.status === 'draft';

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 pb-10">
      <section>
        <Card className="gap-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <Badge className={courseStatusStyles[status]}>{status}</Badge>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {course.title}
              </h1>
              {course.description && (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {course.description}
                </p>
              )}
            </div>
            <CourseStatusActions
              courseId={course.courseId}
              title={course.title}
              status={course.status}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4" /> Updated{' '}
              {new Date(course.updatedAt).toLocaleDateString(undefined, {
                dateStyle: 'medium',
              })}
            </span>
          </div>
        </Card>
      </section>

      {readOnly && (
        <ShadcnAlert
          role="status"
          className="bg-muted/30 text-muted-foreground"
        >
          <Info />
          <AlertDescription>
            This course is archived, so it can't be edited. Restore it to make
            changes.
          </AlertDescription>
        </ShadcnAlert>
      )}

      <section aria-labelledby="content-heading" className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <h2 id="content-heading" className="text-xl font-semibold">
              Course content
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Modules organise this course's lessons.
          </p>
        </div>

        {course.modules.length === 0 ? (
          <Card className="border-dashed py-14 text-center">
            <CardContent>
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BookOpen className="size-6" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">
                Start with your first module
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Modules are the top-level sections of a course. Lessons live
                inside them.
              </p>
              {!readOnly && (
                <CreateModuleDialog
                  courseId={course.courseId}
                  trigger={
                    <Button className="mt-5" type="button">
                      <CirclePlus /> New module
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {course.modules.map((module, moduleIndex) => (
              <Card
                key={module.moduleId}
                className="gap-0 overflow-hidden py-0"
              >
                <CardHeader className="border-b bg-muted/30 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <GripVertical
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
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
                          courseId={course.courseId}
                          moduleId={module.moduleId}
                          title={module.title}
                          visibility={module.visibility}
                          draft={draft}
                          className="ml-auto"
                        />
                        <EditModuleDialog
                          courseId={course.courseId}
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
                          courseId={course.courseId}
                          moduleId={module.moduleId}
                          title={module.title}
                          lessonCount={module.lessons.length}
                          usedItems={module.lessons.reduce(
                            (count, lesson) =>
                              count + usedItemCount(lesson.contentItems),
                            0,
                          )}
                          archive={archiveOnDelete}
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
                      <h4 className="mt-1 text-sm font-semibold">
                        No lessons yet
                      </h4>
                      <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
                        Lessons hold the content students work through inside
                        this module.
                      </p>
                      {!readOnly && (
                        <CreateLessonDialog
                          courseId={course.courseId}
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
                      {module.lessons.map((lesson) => (
                        <article
                          key={lesson.lessonId}
                          className="border-t first:border-t-0"
                        >
                          <div className="group flex items-center gap-2 px-4 py-2.5 sm:pl-12 sm:pr-5">
                            <GripVertical
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
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
                                  courseId={course.courseId}
                                  moduleId={module.moduleId}
                                  lessonId={lesson.lessonId}
                                  title={lesson.title}
                                  visibility={lesson.visibility}
                                  draft={draft}
                                  className="ml-auto"
                                />
                                <EditLessonDialog
                                  courseId={course.courseId}
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
                                  courseId={course.courseId}
                                  moduleId={module.moduleId}
                                  lessonId={lesson.lessonId}
                                  title={lesson.title}
                                  usedItems={usedItemCount(lesson.contentItems)}
                                  archive={archiveOnDelete}
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
                            courseId={course.courseId}
                            moduleId={module.moduleId}
                            lessonId={lesson.lessonId}
                            contentItems={lesson.contentItems}
                            archive={archiveOnDelete}
                            readOnly={readOnly}
                            draft={draft}
                          />
                        </article>
                      ))}
                      {!readOnly && (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-4 py-3 sm:pl-12 sm:pr-5">
                          <CreateLessonDialog
                            courseId={course.courseId}
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
            ))}
            {!readOnly && (
              <div className="flex justify-end">
                <CreateModuleDialog
                  courseId={course.courseId}
                  trigger={
                    <Button type="button" variant="outline">
                      <CirclePlus /> New module
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        )}
      </section>

      <ArchivedSection
        courseId={course.courseId}
        modules={fullCourse.modules}
        readOnly={readOnly}
      />

      {!readOnly && (
        <div className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" /> Modules and lessons shown
          here are live, and you can add new ones, edit or delete lessons or
          modules. Drag a content item by its grip to reorder it within its
          lesson; reordering modules and lessons isn't wired up yet.
        </div>
      )}
    </main>
  );
}
