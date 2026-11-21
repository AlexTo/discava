/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Skeleton } from '@discava/common-shadcn/components/ui/skeleton';
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
  useBreadcrumbLabel(data?.student.displayName);

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
      <main className="space-y-4" role="status" aria-label="Loading submission">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }
  if (query.isError) {
    return (
      <main className="space-y-4">
        <ErrorAlert type="error" header="Couldn't load the submission">
          {apiErrorMessage(query.error, "Couldn't load the submission.")}
        </ErrorAlert>
        {back}
      </main>
    );
  }

  const { assignment, student, submission, feedback } = query.data;
  return (
    <main className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {student.displayName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {assignment.title} · Out of {assignment.maxPoints} points
          </p>
        </div>
        {back}
      </section>
      {submission ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Submitted file">
            <FilePreview
              courseId={courseId}
              contentItemId={contentItemId}
              userId={userId}
              file={submission.file}
            />
          </section>
          <section className="space-y-4" aria-label="Grading">
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
    </main>
  );
}
