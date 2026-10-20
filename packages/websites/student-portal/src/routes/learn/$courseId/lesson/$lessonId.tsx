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
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId, lessonId } = Route.useParams();
  return <LessonPage courseId={courseId} lessonId={lessonId} />;
}
