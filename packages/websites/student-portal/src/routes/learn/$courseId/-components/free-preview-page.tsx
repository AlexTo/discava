/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { useCoreApi } from '../../../../api';
import { EnrolmentActions } from './enrolment-actions';
import { errorCode, FreePreviewItem } from './free-preview-item';

function Unavailable({
  courseId,
  withLink,
}: {
  courseId: string;
  withLink: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-24 text-center lg:px-8">
      <h1 className="text-balance text-xl font-semibold">
        This preview is no longer available.
      </h1>
      {withLink ? (
        <Button className="mt-6" asChild>
          <Link to="/learn/$courseId" params={{ courseId }}>
            View the course
          </Link>
        </Button>
      ) : null}
    </main>
  );
}

// A free preview lesson, open to anyone: the lesson's items and nothing that
// records progress. The course's outline says whether the lesson is open, so
// a lesson it doesn't mark is never asked for.
export function FreePreviewPage({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  const trpc = useCoreApi();
  const courseQuery = useQuery(
    trpc.course.publicView.queryOptions({ courseId }, { retry: false }),
  );
  const module = courseQuery.data?.modules.find((candidate) =>
    candidate.lessons.some((lesson) => lesson.lessonId === lessonId),
  );
  const outlineLesson = module?.lessons.find(
    (lesson) => lesson.lessonId === lessonId,
  );
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const enrolmentQuery = useQuery(
    trpc.course.myEnrolment.queryOptions(
      { courseId },
      { enabled: isAuthenticated },
    ),
  );
  // A student already enrolled when they arrive goes to the lesson. One who
  // enrols from this page is left on it, to choose "Start this lesson".
  const enrolledOnArrival = useRef<boolean | undefined>(undefined);
  if (enrolledOnArrival.current === undefined && !enrolmentQuery.isPending) {
    enrolledOnArrival.current =
      enrolmentQuery.data?.status === 'active' ||
      enrolmentQuery.data?.status === 'completed';
  }
  const redirect = enrolledOnArrival.current === true;
  useEffect(() => {
    if (redirect) {
      void navigate({
        to: '/learn/$courseId/lesson/$lessonId',
        params: { courseId, lessonId },
        replace: true,
      });
    }
  }, [redirect, navigate, courseId, lessonId]);
  const isMarked = outlineLesson?.freePreview === true;
  const lessonQuery = useQuery(
    trpc.freePreview.lesson.queryOptions(
      { courseId, moduleId: module?.moduleId ?? '', lessonId },
      { enabled: isMarked, retry: false },
    ),
  );

  usePageTitle(
    lessonQuery.data?.lesson.title ?? 'Free preview',
    courseQuery.data?.title,
  );

  // The enrolment comes before the states below, so a student of an archived
  // course still reaches their lesson.
  if (redirect) {
    return null;
  }
  if (
    (isAuthenticated && enrolmentQuery.isPending) ||
    courseQuery.isLoading ||
    (isMarked && lessonQuery.isLoading)
  ) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-24 lg:px-8">
        <div
          role="status"
          className="flex items-center justify-center gap-3 text-muted-foreground"
        >
          <Spinner />
          <span>Loading…</span>
        </div>
      </main>
    );
  }
  if (courseQuery.isError) {
    return errorCode(courseQuery.error) === 'NOT_FOUND' ? (
      <Unavailable courseId={courseId} withLink={false} />
    ) : (
      <PageError
        error={courseQuery.error}
        onRetry={() => void courseQuery.refetch()}
      />
    );
  }
  if (!isMarked) {
    return <Unavailable courseId={courseId} withLink />;
  }
  if (lessonQuery.isError) {
    return errorCode(lessonQuery.error) === 'NOT_FOUND' ? (
      <Unavailable courseId={courseId} withLink />
    ) : (
      <PageError
        error={lessonQuery.error}
        onRetry={() => void lessonQuery.refetch()}
      />
    );
  }
  if (!lessonQuery.data || !module || !courseQuery.data) {
    return null;
  }

  const { course, lesson, items } = lessonQuery.data;
  const otherPreviews = courseQuery.data.modules.flatMap((candidate) =>
    candidate.lessons.filter(
      (other) => other.freePreview && other.lessonId !== lessonId,
    ),
  );
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10 lg:px-8">
      <header>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            to="/learn/$courseId"
            params={{ courseId }}
            className="font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            {course.title}
          </Link>
          <Badge variant="secondary">Free preview</Badge>
        </p>
        <h1 className="text-balance mt-2 text-3xl font-bold tracking-tight">
          {lesson.title}
        </h1>
        {lesson.description ? (
          <p className="mt-2 text-muted-foreground">{lesson.description}</p>
        ) : null}
      </header>

      {items.length === 0 ? (
        <p className="text-muted-foreground">
          This lesson has nothing to show yet.
        </p>
      ) : (
        items.map((item) => (
          <FreePreviewItem
            key={item.contentItemId}
            item={item}
            lesson={{ courseId, moduleId: module.moduleId, lessonId }}
          />
        ))
      )}

      <section className="space-y-3 rounded-lg border p-6">
        <h2 className="text-xl font-semibold">Like what you see?</h2>
        <p className="text-sm text-muted-foreground">
          Your progress is saved once you enrol.
        </p>
        <div className="max-w-sm space-y-3">
          <EnrolmentActions
            courseId={courseId}
            courseTitle={courseQuery.data.title}
            priceAmount={courseQuery.data.priceAmount}
            priceCurrency={courseQuery.data.priceCurrency}
            refundWindowDays={courseQuery.data.refundWindowDays}
            refundProgressLimitPercent={
              courseQuery.data.refundProgressLimitPercent
            }
            continueTo={{ lessonId }}
          />
        </div>
      </section>

      {otherPreviews.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">More free previews</h2>
          <ul className="space-y-1">
            {otherPreviews.map((other) => (
              <li key={other.lessonId}>
                <Link
                  to="/learn/$courseId/preview/$lessonId"
                  params={{ courseId, lessonId: other.lessonId }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {other.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function PageError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-24 lg:px-8">
      <ErrorAlert type="error" header="Couldn't load this preview">
        {apiErrorMessage(error)}
      </ErrorAlert>
      <Button className="mt-6" onClick={onRetry}>
        Try again
      </Button>
    </main>
  );
}
