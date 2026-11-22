/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Search over what was said in a course's videos. No track key, file URL,
// versionId or trackId goes out.
export const TranscriptSearchInputSchema = z.object({
  courseId: z.string().min(1),
  q: z.string().trim().min(2).max(200),
  // The learner's caption language (a BCP 47 tag), when they have chosen one.
  language: z.string().min(2).max(35).optional(),
});

export type ITranscriptSearchInput = z.output<
  typeof TranscriptSearchInputSchema
>;

export const TranscriptSearchOutputSchema = z.object({
  items: z
    .array(
      z.object({
        moduleId: z.string(),
        moduleTitle: z.string(),
        lessonId: z.string(),
        lessonTitle: z.string(),
        contentItemId: z.string(),
        itemTitle: z.string(),
        // Start of the caption line holding the first match, in whole seconds.
        startSeconds: z.number().int().min(0),
        language: z.string(),
        // The text around the match. Joining the parts' text gives plain text.
        snippet: z.array(z.object({ text: z.string(), match: z.boolean() })),
      }),
    )
    .max(20),
  // More moments matched than are listed.
  hasMore: z.boolean(),
});

export type ITranscriptSearchOutput = z.output<
  typeof TranscriptSearchOutputSchema
>;
