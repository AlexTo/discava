/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useInstructorApi } from '../../../../../../../api';
import { FeedbackHistory } from './-components/feedback-history';
import { FilePreview } from './-components/file-preview';
import { GradingForm, ReadOnlyNotice } from './-components/grading-form';

export const Route = createFileRoute(
  '/_authenticated/my-courses_/$courseId_/assignments/$contentItemId/submissions/$userId',
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId, contentItemId, userId } = Route.useParams();
  const trpc = useInstructorApi();
  const query = useQuery(
    trpc.assignmentSubmission.get.queryOptions({
      courseId,
      contentItemId,
      userId,
    }),
  );
  const data = query.data;
  useBreadcrumbLabel('Course', `/my-courses/${courseId}`);
  useBreadcrumbLabel(
    data?.assignment.title,
    `/my-courses/${courseId}/assignments/${contentItemId}`,
  );
  useBreadcrumbLabel(data?.student.displayName);
  usePageTitle(
    data ? data.student.displayName : 'Submission',
    data?.assignment.title,
  );

  const back = (
    <Button asChild variant="outline" size="sm">
      <Link
        to="/my-courses/$courseId/assignments/$contentItemId/submissions"
        params={{ courseId, contentItemId }}
      >
        Back to submissions
      </Link>
    </Button>
  );

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Submission
        </h1>
        <LoadingState label="Loading the submission…" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Submission
        </h1>
        <ErrorAlert type="error" header="Couldn't load the submission">
          {apiErrorMessage(query.error, "Couldn't load the submission.")}
        </ErrorAlert>
        {back}
      </div>
    );
  }

  const { assignment, student, submission, feedback } = query.data;
  return (
    <div className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance [overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
            {student.displayName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {assignment.title} · Out of {assignment.maxPoints} points
          </p>
        </div>
        {back}
      </section>
      {submission ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="min-w-0" aria-label="Submitted file">
            <FilePreview
              courseId={courseId}
              contentItemId={contentItemId}
              userId={userId}
              file={submission.file}
            />
          </section>
          <section className="min-w-0 space-y-4" aria-label="Grading">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                Submitted {new Date(submission.submittedAt).toLocaleString()}
              </span>
              <span>Version {submission.version}</span>
              {submission.late ? <Badge variant="outline">Late</Badge> : null}
              {student.enrolled ? null : (
                <Badge variant="secondary">No longer enrolled</Badge>
              )}
            </p>
            {student.enrolled ? (
              <GradingForm
                courseId={courseId}
                contentItemId={contentItemId}
                userId={userId}
                maxPoints={assignment.maxPoints}
                submission={submission}
              />
            ) : (
              <ReadOnlyNotice />
            )}
          </section>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This student hasn't submitted yet.
        </p>
      )}
      <FeedbackHistory rounds={feedback} />
    </div>
  );
}
