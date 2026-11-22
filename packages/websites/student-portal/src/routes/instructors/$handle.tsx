/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@discava/common-shadcn/components/ui/avatar';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useCoreApi } from '../../api';
import { CourseCard } from '../../components/course-card';
import type { DisplayCourse } from '../../lib/course-display';
import { toDisplayCourse } from '../../lib/course-display';
import { initialsOf } from '../../lib/initials';

// An instructor's public profile: who they are and the published courses they
// teach. Everything on it is plain text, bio included.
export const Route = createFileRoute('/instructors/$handle')({
  component: RouteComponent,
});

// The bio's paragraphs: blank lines separate them.
const paragraphsOf = (bio: string) =>
  bio
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

function NotFound() {
  return (
    <div className="py-16 text-center">
      <Search className="mx-auto size-8 text-muted-foreground" />
      <h1 className="text-balance mt-4 text-xl font-semibold">
        Instructor not found
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        There is no instructor at this address.
      </p>
      <Button className="mt-5" variant="outline" asChild>
        <Link to="/">Browse courses</Link>
      </Button>
    </div>
  );
}

function RouteComponent() {
  const { handle } = Route.useParams();
  const trpc = useCoreApi();
  const photoUrlFor = usePublicMediaUrl();
  const profileQuery = useQuery(
    trpc.instructorProfile.publicView.queryOptions(
      { handle },
      {
        // A cold start is not "not found"; only NOT_FOUND ends the lookup.
        retry: (failureCount, error) =>
          (error as { data?: { code?: string } }).data?.code !== 'NOT_FOUND' &&
          failureCount < 1,
      },
    ),
  );
  const profile = profileQuery.data;

  usePageTitle(profile?.displayName ?? 'Instructor');

  const notFound =
    (profileQuery.error as { data?: { code?: string } } | null)?.data?.code ===
    'NOT_FOUND';

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-8">
      {profileQuery.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : notFound ? (
        <NotFound />
      ) : profileQuery.isError || !profile ? (
        <ErrorAlert
          type="error"
          header="Couldn't load this profile"
          onRetry={() => profileQuery.refetch()}
        >
          <p>{apiErrorMessage(profileQuery.error)}</p>
        </ErrorAlert>
      ) : (
        <>
          <header className="flex flex-col items-start gap-6 sm:flex-row">
            <Avatar className="size-28">
              {photoUrlFor(profile.photoKey) ? (
                <AvatarImage src={photoUrlFor(profile.photoKey)} alt="" />
              ) : null}
              <AvatarFallback aria-hidden="true" className="text-3xl">
                {initialsOf(profile.displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 max-w-2xl">
              <h1 className="text-balance text-3xl font-bold tracking-tight">
                {profile.displayName}
              </h1>
              {profile.headline ? (
                <p className="mt-2 text-lg text-muted-foreground">
                  {profile.headline}
                </p>
              ) : null}
              {profile.bio
                ? paragraphsOf(profile.bio).map((paragraph) => (
                    <p
                      key={paragraph}
                      className="mt-4 whitespace-pre-line leading-7"
                    >
                      {paragraph}
                    </p>
                  ))
                : null}
            </div>
          </header>
          <section className="mt-12" aria-labelledby="instructor-courses">
            <h2
              id="instructor-courses"
              className="text-xl font-semibold tracking-tight"
            >
              Courses by {profile.displayName}
            </h2>
            {profile.courses.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No published courses yet.
              </p>
            ) : (
              <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {profile.courses.map((course) => {
                  const display: DisplayCourse = {
                    ...toDisplayCourse(course),
                    // The profile does not carry descriptions.
                    description: '',
                  };
                  return <CourseCard key={course.courseId} course={display} />;
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
