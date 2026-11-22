/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@discava/common-shadcn/components/ui/tabs';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useCoreApi } from '../../api';
import { CourseProgressCard } from '../../components/course-progress-card';
import { PageBreadcrumbs } from '../../components/page-breadcrumbs';
import { PageContainer } from '../../components/page-container';
import { requireSignIn } from '../../lib/require-sign-in';
import { CertificateActions } from './-components/certificate-actions';

// The student's courses, in progress and completed, as on Coursera's
// /my-learning: each with its progress and what's next.
export const Route = createFileRoute('/my-learning/')({
  beforeLoad: requireSignIn,
  component: MyLearning,
});

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function MyLearning() {
  usePageTitle('My Learning');
  const trpc = useCoreApi();
  const enrolmentsQuery = useQuery(trpc.course.myEnrolments.queryOptions());
  const enrolments = enrolmentsQuery.data?.items ?? [];
  const inProgress = enrolments.filter((e) => e.status === 'active');
  const completed = enrolments.filter((e) => e.status === 'completed');
  // A failed read just means no Certificate controls: the rest of the page
  // doesn't depend on it.
  const certificatesQuery = useQuery(
    trpc.certificate.myCertificates.queryOptions(),
  );
  const certificatesByCourse = new Map(
    (certificatesQuery.data ?? []).map((c) => [c.courseId, c]),
  );

  return (
    <PageContainer className="space-y-6">
      <PageBreadcrumbs crumbs={[{ label: 'My Learning' }]} />
      <h1 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
        My Learning
      </h1>
      {enrolmentsQuery.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : enrolmentsQuery.isError ? (
        <ErrorAlert type="error" header="Couldn't load your courses">
          {apiErrorMessage(enrolmentsQuery.error)}
        </ErrorAlert>
      ) : (
        <Tabs defaultValue="in-progress">
          <TabsList>
            <TabsTrigger value="in-progress">
              In progress ({inProgress.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed ({completed.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="in-progress" className="pt-4">
            {inProgress.length === 0 ? (
              <Empty>
                No courses in progress.{' '}
                <Link
                  to="/courses"
                  search={{}}
                  className="font-medium text-foreground underline"
                >
                  Find one to start
                </Link>
                .
              </Empty>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inProgress.map((course) => (
                  <CourseProgressCard key={course.courseId} course={course} />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="completed" className="pt-4">
            {completed.length === 0 ? (
              <Empty>Courses you complete show up here.</Empty>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {completed.map((course) => {
                  const certificate = certificatesByCourse.get(course.courseId);
                  return (
                    <div key={course.courseId} className="flex flex-col gap-3">
                      <CourseProgressCard course={course} className="flex-1" />
                      {certificate ? (
                        <CertificateActions
                          courseId={course.courseId}
                          certificateId={certificate.certificateId}
                          courseTitle={certificate.courseTitle}
                          completedAt={certificate.completedAt}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
