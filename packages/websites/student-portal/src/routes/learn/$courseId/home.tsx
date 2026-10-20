/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireSignIn } from '../../../lib/require-sign-in';
import { CourseHome } from './-components/course-home';

// A course's own home for an enrolled student: its outline, and where to
// pick up.
export const Route = createFileRoute('/learn/$courseId/home')({
  beforeLoad: requireSignIn,
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  return <CourseHome courseId={courseId} />;
}
