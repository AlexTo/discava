/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AlertDescription,
  Alert as ShadcnAlert,
} from '@discava/common-shadcn/components/ui/alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Card } from '@discava/common-shadcn/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, CalendarDays, Info } from 'lucide-react';
import { useBreadcrumbLabel } from '../../../../components/AppLayout/breadcrumb-label';
import { Alert } from '../../../../components/alert';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../../../components/course-status';
import { Spinner } from '../../../../components/spinner';
import { useInstructorApi } from '../../../../hooks/useInstructorApi';
import { ArchivedSection } from './-components/course/archived-section';
import { CourseImage } from './-components/course/course-image';
import { CourseModules } from './-components/course/course-modules';
import { CourseStatusActions } from './-components/course/course-status-actions';

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
            <CourseImage
              courseId={course.courseId}
              imageKey={course.imageKey}
              readOnly={readOnly}
            />
            <div className="min-w-0 flex-1">
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

        <CourseModules
          courseId={course.courseId}
          modules={course.modules}
          archive={archiveOnDelete}
          readOnly={readOnly}
          draft={draft}
        />
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
          modules. Drag a module, lesson or content item by its grip to reorder
          it: modules within the course, lessons within their module and content
          items within their lesson.
        </div>
      )}
    </main>
  );
}
