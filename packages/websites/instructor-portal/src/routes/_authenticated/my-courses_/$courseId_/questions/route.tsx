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
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  type SearchSchemaInput,
  stripSearchParams,
} from '@tanstack/react-router';
import { useInstructorApi } from '../../../../../api';
import { correctSearch } from '../../../../../lib/canonical-search';
import { ByLessonView } from './-components/by-lesson-view';
import { ReportedView } from './-components/reported-view';
import { UnansweredView } from './-components/unanswered-view';

const tabs = ['unanswered', 'reported', 'by-lesson'] as const;
type QuestionsTab = (typeof tabs)[number];

// `$courseId_` keeps this route out of the course page's layout, like
// reviews.
export const Route = createFileRoute(
  '/_authenticated/my-courses_/$courseId_/questions',
)({
  // The tab and the lesson are kept in the URL so the view survives a reload
  // and can be shared. A tab at its default is left out of the address.
  validateSearch: (
    search: Record<string, unknown> & SearchSchemaInput,
  ): { tab: QuestionsTab; lesson?: string } => ({
    tab: tabs.includes(search.tab as QuestionsTab)
      ? (search.tab as QuestionsTab)
      : 'unanswered',
    ...(typeof search.lesson === 'string' && search.lesson
      ? { lesson: search.lesson }
      : {}),
  }),
  search: { middlewares: [stripSearchParams({ tab: 'unanswered' })] },
  // An invalid value in the address is replaced by the one it fell back to.
  beforeLoad: ({ search, location }) =>
    correctSearch(location.search, {
      tab: search.tab === 'unanswered' ? undefined : search.tab,
      lesson: search.lesson,
    }),
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  const { tab, lesson } = Route.useSearch();
  const navigate = Route.useNavigate();
  useBreadcrumbLabel('Course', `/my-courses/${courseId}`);
  // Shares the course editor's cached answer.
  const courseQuery = useQuery(
    useInstructorApi().course.view.queryOptions({ courseId }),
  );
  usePageTitle('Questions', courseQuery.data?.title);

  return (
    <div className="w-full space-y-6 pb-8">
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
      <Tabs
        value={tab}
        onValueChange={(next) =>
          void navigate({
            search: { tab: next as QuestionsTab },
          })
        }
      >
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
          <ByLessonView
            courseId={courseId}
            lessonId={tab === 'by-lesson' ? lesson : undefined}
            onLessonChange={(next) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  lesson: next || undefined,
                }),
              })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
