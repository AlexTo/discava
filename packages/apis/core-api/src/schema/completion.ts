/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Where a content item sits in the curriculum: its full key.
export const ContentItemRefSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
});

export type IContentItemRef = z.output<typeof ContentItemRefSchema>;

export const ItemCompletionSchema = ContentItemRefSchema.extend({
  completedAt: z.string(),
});

export type IItemCompletion = z.output<typeof ItemCompletionSchema>;

export const CompleteContentItemInputSchema = ContentItemRefSchema;

export type ICompleteContentItemInput = z.output<
  typeof CompleteContentItemInputSchema
>;

export const CompleteContentItemOutputSchema = ItemCompletionSchema;

export const MyCompletionsInputSchema = z.object({
  courseId: z.string(),
});

export type IMyCompletionsInput = z.output<typeof MyCompletionsInputSchema>;

// Every item the caller has completed in the course, including ones since
// hidden or archived: which still count is decided from the curriculum.
export const MyCompletionsOutputSchema = z.object({
  items: z.array(ItemCompletionSchema),
});

export type IMyCompletionsOutput = z.output<typeof MyCompletionsOutputSchema>;
