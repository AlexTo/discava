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

export const MyItemCompletionsInputSchema = z.object({
  courseId: z.string(),
});

export type IMyItemCompletionsInput = z.output<
  typeof MyItemCompletionsInputSchema
>;

// Every item the caller has completed in the course, including ones since
// hidden or archived: which still count is decided from the curriculum.
export const MyItemCompletionsOutputSchema = z.object({
  items: z.array(ItemCompletionSchema),
});

export type IMyItemCompletionsOutput = z.output<
  typeof MyItemCompletionsOutputSchema
>;
