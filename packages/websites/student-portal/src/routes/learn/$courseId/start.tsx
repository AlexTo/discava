/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { requireSignIn } from '../../../lib/require-sign-in';
import { StartCourse } from './-components/start-course';

// Where a learner lands after enrolling: it finds their next lesson and
// replaces itself with it.
export const Route = createFileRoute('/learn/$courseId/start')({
  beforeLoad: requireSignIn,
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  return <StartCourse courseId={courseId} />;
}
