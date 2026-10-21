/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@discava/common-shadcn/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Alert } from '../components/alert';
import { CourseProgressCard } from '../components/course-progress-card';
import { Spinner } from '../components/spinner';
import { useCoreApi } from '../hooks/useCoreApi';
import { requireSignIn } from '../lib/require-sign-in';

// The student's courses, in progress and completed, as on Coursera's
// /my-learning: each with its progress and what's next.
export const Route = createFileRoute('/my-learning')({
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
  const trpc = useCoreApi();
  const enrolmentsQuery = useQuery(trpc.course.myEnrolments.queryOptions());
  const enrolments = enrolmentsQuery.data?.items ?? [];
  const inProgress = enrolments.filter((e) => e.status === 'active');
  const completed = enrolments.filter((e) => e.status === 'completed');

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 pt-8 pb-10 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        My Learning
      </h1>
      {enrolmentsQuery.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : enrolmentsQuery.isError ? (
        <Alert type="error" header="Couldn't load your courses">
          {enrolmentsQuery.error.message}
        </Alert>
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
                <Link to="/" className="font-medium text-foreground underline">
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
                {completed.map((course) => (
                  <CourseProgressCard key={course.courseId} course={course} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}
