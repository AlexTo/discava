/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocation } from '@tanstack/react-router';

// The confirmation after enrolling: shown above the lesson or the course home
// the learner was just taken to, and only then (the start route sets the
// history state). It takes no focus and has no button.
export function EnrolledNotice({ courseTitle }: { courseTitle: string }) {
  const enrolled = useLocation({
    select: (location) => location.state.enrolled,
  });
  if (!enrolled) {
    return null;
  }
  return (
    <p
      role="status"
      className="rounded-md border bg-primary/5 px-4 py-3 text-sm font-medium"
    >
      You're enrolled in {courseTitle}.
    </p>
  );
}
