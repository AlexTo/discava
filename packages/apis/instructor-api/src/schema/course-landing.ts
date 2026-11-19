/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LANDING_ITEM_MAX_LENGTH,
  LANDING_LIST_MAX_ITEMS,
} from '@discava/core-table';
import { z } from 'zod';
import { CourseSchema } from './course.js';

// At most 10 items, each 1 to 160 characters once trimmed. A violation names
// the field and the item's 1-based position. core-table's courseLandingWrites
// trims and checks again, since every writer shares it.
const landingList = (field: string) =>
  z
    .array(z.string())
    .max(LANDING_LIST_MAX_ITEMS, `${field} can have at most 10 items`)
    .superRefine((items, ctx) => {
      items.forEach((item, index) => {
        const length = item.trim().length;
        if (length < 1 || length > LANDING_ITEM_MAX_LENGTH) {
          ctx.addIssue({
            code: 'custom',
            message: `${field} item ${index + 1} must be 1 to ${LANDING_ITEM_MAX_LENGTH} characters`,
          });
        }
      });
    });

// Both lists are replaced; an empty one clears it.
export const UpdateCourseLandingInputSchema = z.object({
  courseId: z.string(),
  learningOutcomes: landingList('Learning outcomes'),
  requirements: landingList('Requirements'),
});

export type IUpdateCourseLandingInput = z.output<
  typeof UpdateCourseLandingInputSchema
>;

export const UpdateCourseLandingOutputSchema = CourseSchema;
