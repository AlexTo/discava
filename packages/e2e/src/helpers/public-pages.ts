/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ApiUser } from './api.js';
import { PORTALS } from './portals.js';

// Steps for the public course pages, for scenarios to build on.

// Sets a course's outcomes and requirements through instructor-api, as the
// instructor portal's landing page card will once it exists.
export const setLandingViaApi = async (
  instructor: ApiUser,
  courseId: string,
  landing: { learningOutcomes: string[]; requirements: string[] },
) => {
  await instructor.instructor.course.updateLanding.mutate({
    courseId,
    ...landing,
  });
};

// The address of a course's public page.
export const coursePageUrl = (courseId: string) =>
  `${PORTALS.student}/learn/${courseId}`;
