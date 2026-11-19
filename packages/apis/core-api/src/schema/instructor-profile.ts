/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Not validated as a handle: input that isn't one gives NOT_FOUND, the same
// as a handle nobody has, so probing reveals nothing.
export const InstructorProfilePublicViewInputSchema = z.object({
  handle: z.string(),
});

// No ids of people (instructorId, userId) and no email: the output schema
// strips anything else.
export const InstructorProfilePublicViewOutputSchema = z.object({
  handle: z.string(),
  displayName: z.string(),
  headline: z.string().optional(),
  bio: z.string().optional(),
  photoKey: z.string().optional(),
  courses: z.array(
    z.object({
      courseId: z.string(),
      title: z.string(),
      imageKey: z.string().optional(),
      ratingAverage: z.number().optional(),
      ratingCount: z.number(),
    }),
  ),
});

export type IInstructorProfilePublicViewOutput = z.output<
  typeof InstructorProfilePublicViewOutputSchema
>;
