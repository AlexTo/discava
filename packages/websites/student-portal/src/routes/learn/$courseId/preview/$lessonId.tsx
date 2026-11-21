/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { FreePreviewPage } from '../-components/free-preview-page';

// A free preview lesson. Public: no requireSignIn, because anyone may open a
// lesson its instructor marked, without an account or an enrolment.
export const Route = createFileRoute('/learn/$courseId/preview/$lessonId')({
  component: RouteComponent,
});

function RouteComponent() {
  const { courseId, lessonId } = Route.useParams();
  return <FreePreviewPage courseId={courseId} lessonId={lessonId} />;
}
