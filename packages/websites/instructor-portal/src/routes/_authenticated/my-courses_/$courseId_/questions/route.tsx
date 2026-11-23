/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBreadcrumbLabel } from '@discava/common-shadcn/components/breadcrumb-label';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@discava/common-shadcn/components/ui/tabs';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ByLessonView } from './-components/by-lesson-view';
import { ReportedView } from './-components/reported-view';
import { UnansweredView } from './-components/unanswered-view';

// `$courseId_` keeps this route out of the course page's layout, like
// reviews.
export const Route = createFileRoute(
  '/_authenticated/my-courses_/$courseId_/questions',
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  useBreadcrumbLabel('Course', `/my-courses/${courseId}`);

  return (
    <main className="w-full space-y-6 pb-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-balance break-words [overflow-wrap:anywhere] text-2xl font-bold tracking-tight sm:text-3xl">
            Questions
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            What students ask about this course's lessons. Answer them, and hide
            or delete posts that don't belong.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/my-courses/$courseId" params={{ courseId }}>
            Back to course
          </Link>
        </Button>
      </section>
      <Tabs defaultValue="unanswered">
        <TabsList>
          <TabsTrigger value="unanswered">Unanswered</TabsTrigger>
          <TabsTrigger value="reported">Reported</TabsTrigger>
          <TabsTrigger value="by-lesson">By lesson</TabsTrigger>
        </TabsList>
        <TabsContent value="unanswered" className="pt-4">
          <UnansweredView courseId={courseId} />
        </TabsContent>
        <TabsContent value="reported" className="pt-4">
          <ReportedView courseId={courseId} />
        </TabsContent>
        <TabsContent value="by-lesson" className="pt-4">
          <ByLessonView courseId={courseId} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
