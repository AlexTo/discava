/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireSignIn } from '../../../../lib/require-sign-in';
import { LessonPage } from '../-components/lesson-page';

// One lesson of a course, for an enrolled student: all its items on one page.
export const Route = createFileRoute('/learn/$courseId/lesson/$lessonId')({
  beforeLoad: requireSignIn,
  // A transcript search result opens a video at a second: `t` is kept only as
  // a whole number of seconds from 0.
  validateSearch: (
    search: Record<string, unknown>,
  ): { item?: string; t?: number } => ({
    ...(typeof search.item === 'string' && search.item
      ? { item: search.item }
      : {}),
    ...(typeof search.t === 'number' &&
    Number.isInteger(search.t) &&
    search.t >= 0
      ? { t: search.t }
      : {}),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId, lessonId } = Route.useParams();
  const { item, t } = Route.useSearch();
  return (
    <LessonPage courseId={courseId} lessonId={lessonId} item={item} t={t} />
  );
}
