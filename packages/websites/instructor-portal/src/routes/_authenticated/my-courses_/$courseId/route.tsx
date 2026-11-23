/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import {
  AlertDescription,
  Alert as ShadcnAlert,
} from '@discava/common-shadcn/components/ui/alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Card } from '@discava/common-shadcn/components/ui/card';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  BookOpen,
  CalendarDays,
  Captions,
  Info,
  ListChecks,
  Megaphone,
  Presentation,
  Tags,
} from 'lucide-react';
import { useInstructorApi } from '../../../../api';
import {
  type CourseStatus,
  courseStatusStyles,
} from '../../../../lib/course-status';
import { AnnouncementsSection } from './-components/announcements/announcements-section';
import { ArchivedSection } from './-components/course/archived-section';
import { CourseCaptionLanguagesForm } from './-components/course/course-caption-languages-form';
import { CourseCatalogueForm } from './-components/course/course-catalogue-form';
import { CourseCertificateCriteria } from './-components/course/course-certificate-criteria';
import { CourseCertificatesList } from './-components/course/course-certificates-list';
import { CourseCertificatesSwitch } from './-components/course/course-certificates-switch';
import { CourseFirstLessonPromptForm } from './-components/course/course-first-lesson-prompt-form';
import { CourseImage } from './-components/course/course-image';
import { CourseModules } from './-components/course/course-modules';
import { CoursePriceForm } from './-components/course/course-price-form';
import { CourseStatusActions } from './-components/course/course-status-actions';
import { LandingPageCard } from './-components/course/landing-page-card';
import { LandingPageChecklist } from './-components/course/landing-page-checklist';
import { UnsavedChangesProvider } from './-components/course/unsaved-changes-context';

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
  const { portals } = useRuntimeConfig();
  const trpc = useInstructorApi();
  const {
    isPending,
    isError,
    error,
    data: fullCourse,
    refetch,
  } = useQuery(trpc.course.view.queryOptions({ courseId }));

  const profileQuery = useQuery(trpc.profile.get.queryOptions());
  // The checklist's profile line: a headline and a photo. Left unknown until
  // the profile has loaded.
  const profile = profileQuery.data;
  const hasProfile = profile
    ? Boolean(profile.headline && profile.photoKey)
    : undefined;

  useBreadcrumbLabel(fullCourse?.title);
  usePageTitle(fullCourse?.title ?? 'Course', fullCourse && 'My Courses');

  if (isPending) {
    return (
      <div className="space-y-4">
        <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Course
        </h1>
        <div className="py-12">
          <LoadingState label="Loading the course…" size="page" />
        </div>
      </div>
    );
  }

  if (isError) {
    const notFound = error.data?.code === 'NOT_FOUND';
    return (
      <div className="space-y-4">
        <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Course
        </h1>
        <ErrorAlert
          type="error"
          header={notFound ? 'Course not found' : "Couldn't load this course"}
          onRetry={notFound ? undefined : () => void refetch()}
        >
          {notFound
            ? "This course doesn't exist, or you don't have access to it."
            : apiErrorMessage(error)}
        </ErrorAlert>
        {notFound && (
          <Button asChild variant="outline" size="sm">
            <Link to="/my-courses">Back to My Courses</Link>
          </Button>
        )}
      </div>
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
    <UnsavedChangesProvider enabled={!readOnly}>
      <div className="mx-auto w-full max-w-5xl space-y-6 pb-10">
        <section>
          <Card className="gap-0 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div id="course-image">
                <CourseImage
                  courseId={course.courseId}
                  imageKey={course.imageKey}
                  readOnly={readOnly}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Badge className={courseStatusStyles[status]}>{status}</Badge>
                <h1 className="text-balance mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
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
              <Link
                to="/my-courses/$courseId/reviews"
                params={{ courseId: course.courseId }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Reviews
              </Link>
              <Link
                to="/my-courses/$courseId/questions"
                params={{ courseId: course.courseId }}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Questions
              </Link>
            </div>
            <div className="mt-4 border-t pt-4">
              <h2 className="mb-3 text-lg font-semibold">Course settings</h2>
              <CourseCertificatesSwitch
                courseId={course.courseId}
                certificatesEnabled={course.certificatesEnabled}
              />
              <div className="mt-3 ml-12">
                <CourseCertificateCriteria
                  courseId={course.courseId}
                  certificatesEnabled={course.certificatesEnabled}
                  requireQuizPass={course.certificateCriteria.requireQuizPass}
                  minUploadScorePercent={
                    course.certificateCriteria.minUploadScorePercent
                  }
                />
              </div>
            </div>
            <div className="mt-4 border-t pt-4">
              <CourseCertificatesList courseId={course.courseId} />
            </div>
            <div className="mt-4 border-t pt-4">
              <CourseFirstLessonPromptForm
                courseId={course.courseId}
                firstLessonPrompt={course.firstLessonPrompt}
                defaultFirstLessonPrompt={course.defaultFirstLessonPrompt}
              />
            </div>
            <div className="mt-4 border-t pt-4">
              <CoursePriceForm
                courseId={course.courseId}
                priceAmount={course.priceAmount}
                priceCurrency={course.priceCurrency}
              />
            </div>
          </Card>
        </section>

        <section
          aria-labelledby="landing-checklist-heading"
          className="space-y-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <ListChecks className="size-5 text-primary" />
              <h2
                id="landing-checklist-heading"
                className="text-xl font-semibold"
              >
                Landing page checklist
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              What makes the public page persuasive. It's a guide only: you can
              publish at any time.
            </p>
          </div>
          <Card className="p-5 sm:p-6">
            <LandingPageChecklist
              publicPageUrl={
                course.status === 'published' && portals?.StudentPortal
                  ? `${portals.StudentPortal}/learn/${course.courseId}`
                  : undefined
              }
              hasOutcomes={(course.learningOutcomes?.length ?? 0) > 0}
              hasRequirements={(course.requirements?.length ?? 0) > 0}
              hasPreview={course.preview?.status === 'ready'}
              hasImage={Boolean(course.imageKey)}
              hasProfile={hasProfile}
              profileFailed={profileQuery.isError}
              onRetryProfile={() => void profileQuery.refetch()}
            />
          </Card>
        </section>

        <section aria-labelledby="catalogue-heading" className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Tags className="size-5 text-primary" />
              <h2 id="catalogue-heading" className="text-xl font-semibold">
                Catalogue details
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              How students find this course when they browse and filter the
              catalogue.
            </p>
          </div>
          <Card className="p-5 sm:p-6">
            <CourseCatalogueForm
              courseId={course.courseId}
              category={course.category}
              tags={course.tags}
              level={course.level}
              language={course.language}
              durationHours={course.durationHours}
              readOnly={readOnly}
            />
          </Card>
        </section>

        <section
          aria-labelledby="caption-languages-heading"
          className="space-y-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <Captions className="size-5 text-primary" />
              <h2
                id="caption-languages-heading"
                className="text-xl font-semibold"
              >
                Caption languages
              </h2>
            </div>
          </div>
          <Card className="p-5 sm:p-6">
            <CourseCaptionLanguagesForm
              courseId={course.courseId}
              readOnly={readOnly}
            />
          </Card>
        </section>

        <section
          id="landing-page"
          aria-labelledby="landing-page-heading"
          className="space-y-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <Presentation className="size-5 text-primary" />
              <h2 id="landing-page-heading" className="text-xl font-semibold">
                Landing page
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              What visitors read on the public course page before they enrol.
            </p>
          </div>
          <Card className="p-5 sm:p-6">
            <LandingPageCard
              courseId={course.courseId}
              learningOutcomes={course.learningOutcomes}
              requirements={course.requirements}
              preview={course.preview}
              readOnly={readOnly}
            />
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
              <h2
                id="content-heading"
                tabIndex={-1}
                className="text-xl font-semibold"
              >
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

        <section aria-labelledby="announcements-heading" className="space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <Megaphone className="size-5 text-primary" />
              <h2
                id="announcements-heading"
                tabIndex={-1}
                className="text-xl font-semibold"
              >
                Announcements
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Post news to the students enrolled in this course.
            </p>
          </div>

          <AnnouncementsSection
            courseId={course.courseId}
            archived={readOnly}
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
            <Info className="mt-0.5 size-4 shrink-0" /> Modules and lessons
            shown here are live, and you can add new ones, edit or delete
            lessons or modules. Drag a module, lesson or content item by its
            grip to reorder it: modules within the course, lessons within their
            module and content items within their lesson.
          </div>
        )}
      </div>
    </UnsavedChangesProvider>
  );
}
