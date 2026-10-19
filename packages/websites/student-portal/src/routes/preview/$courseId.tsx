/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

// A course's page used to live here; it's /learn/<courseId> now. Kept so old
// links and bookmarks still work.
export const Route = createFileRoute('/preview/$courseId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/learn/$courseId',
      params: { courseId: params.courseId },
      replace: true,
    });
  },
});
