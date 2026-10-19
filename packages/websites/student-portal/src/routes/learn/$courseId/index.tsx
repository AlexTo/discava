/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { CoursePage } from './-components/course-page';

// A course's page, for everyone: what it covers, and enrolling in it.
export const Route = createFileRoute('/learn/$courseId/')({
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId } = Route.useParams();
  return <CoursePage courseId={courseId} />;
}
