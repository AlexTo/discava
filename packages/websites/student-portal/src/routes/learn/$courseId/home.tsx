/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireSignIn } from '../../../lib/require-sign-in';
import { CourseContent } from './-components/course-content';

// A course's own home, where its lessons are. Still the mock player until the
// lesson player uses real content (#148 item 7c).
export const Route = createFileRoute('/learn/$courseId/home')({
  beforeLoad: requireSignIn,
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  return <CourseContent courseCode={courseId} />;
}
