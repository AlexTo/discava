/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireSignIn } from '../../../lib/require-sign-in';
import { CoursePlayerLayout } from './-components/course-player';
import { TranscriptSearchResults } from './-components/transcript-search-results';

// Moments in a course's videos where something was said, for an enrolled
// student.
export const Route = createFileRoute('/learn/$courseId/search')({
  beforeLoad: requireSignIn,
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === 'string' ? { q: search.q } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  const { q } = Route.useSearch();
  return (
    <CoursePlayerLayout courseId={courseId} crumb="Search" query={q}>
      {() => <TranscriptSearchResults courseId={courseId} q={q ?? ''} />}
    </CoursePlayerLayout>
  );
}
