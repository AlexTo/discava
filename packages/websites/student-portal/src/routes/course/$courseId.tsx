/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

// A course's lessons used to live here; they're under
// /learn/<courseId>/home now. Kept so old links and bookmarks still work.
export const Route = createFileRoute('/course/$courseId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/learn/$courseId/home',
      params: { courseId: params.courseId },
      replace: true,
    });
  },
});
