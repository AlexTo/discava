/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { ContentItemRefSchema } from './completion.js';
import { VideoUrlOutputSchema } from './content-item.js';

// A free preview lesson (open to anyone, signed in or not): what a visitor
// may read of it. Every object is strict, so a field added to a record never
// reaches visitors unless it is added here on purpose.
export const FreePreviewLessonInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
});

export type IFreePreviewLessonInput = z.output<
  typeof FreePreviewLessonInputSchema
>;

const base = {
  contentItemId: z.string(),
  title: z.string(),
  description: z.string().optional(),
};

export const FreePreviewItemSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('video'),
      durationSeconds: z.number().optional(),
      playable: z.boolean(),
    })
    .strict(),
  z.object({ ...base, type: z.literal('text'), body: z.string() }).strict(),
  z
    .object({
      ...base,
      type: z.literal('file'),
      fileName: z.string(),
      fileSize: z.number(),
      mimeType: z.string(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('quiz'),
      questionCount: z.number().int(),
    })
    .strict(),
]);

export type IFreePreviewItem = z.output<typeof FreePreviewItemSchema>;

export const FreePreviewLessonOutputSchema = z
  .object({
    course: z.object({ courseId: z.string(), title: z.string() }).strict(),
    lesson: z
      .object({
        lessonId: z.string(),
        moduleId: z.string(),
        title: z.string(),
        description: z.string().optional(),
      })
      .strict(),
    items: z.array(FreePreviewItemSchema),
  })
  .strict();

export type IFreePreviewLessonOutput = z.output<
  typeof FreePreviewLessonOutputSchema
>;

export const FreePreviewMediaInputSchema = ContentItemRefSchema;

// This operation's own schema: nothing added to contentItem.videoUrl's output
// (in-video questions, #591) reaches visitors unless it is added here on
// purpose. A visitor has no saved position.
export const FreePreviewVideoUrlOutputSchema = VideoUrlOutputSchema.omit({
  resumeAt: true,
}).strict();

export type IFreePreviewVideoUrlOutput = z.output<
  typeof FreePreviewVideoUrlOutputSchema
>;
