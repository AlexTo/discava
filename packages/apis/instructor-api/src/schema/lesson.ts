/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { CurriculumVisibilitySchema } from './visibility.js';

export const LessonSchema = z.object({
  lessonId: z.string(),
  moduleId: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  visibility: CurriculumVisibilitySchema,
  archivedAt: z.string().optional(),
  publishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ILesson = z.output<typeof LessonSchema>;

export const CreateLessonInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

export type ICreateLessonInput = z.output<typeof CreateLessonInputSchema>;

export const CreateLessonOutputSchema = LessonSchema;

export type ICreateLessonOutput = z.output<typeof CreateLessonOutputSchema>;

export const UpdateLessonInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
});

export type IUpdateLessonInput = z.output<typeof UpdateLessonInputSchema>;

export const UpdateLessonOutputSchema = LessonSchema;

export type IUpdateLessonOutput = z.output<typeof UpdateLessonOutputSchema>;

export const DeleteLessonInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
});

export type IDeleteLessonInput = z.output<typeof DeleteLessonInputSchema>;

export const DeleteLessonOutputSchema = LessonSchema;

export type IDeleteLessonOutput = z.output<typeof DeleteLessonOutputSchema>;

const LessonKeySchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
});

export const PublishLessonInputSchema = LessonKeySchema;

export type IPublishLessonInput = z.output<typeof PublishLessonInputSchema>;

export const PublishLessonOutputSchema = LessonSchema;

export type IPublishLessonOutput = z.output<typeof PublishLessonOutputSchema>;

export const HideLessonInputSchema = LessonKeySchema;

export type IHideLessonInput = z.output<typeof HideLessonInputSchema>;

export const HideLessonOutputSchema = LessonSchema;

export type IHideLessonOutput = z.output<typeof HideLessonOutputSchema>;

export const RestoreLessonInputSchema = LessonKeySchema;

export type IRestoreLessonInput = z.output<typeof RestoreLessonInputSchema>;

export const RestoreLessonOutputSchema = LessonSchema;

export type IRestoreLessonOutput = z.output<typeof RestoreLessonOutputSchema>;

export const DeleteLessonPermanentlyInputSchema = LessonKeySchema;

export type IDeleteLessonPermanentlyInput = z.output<
  typeof DeleteLessonPermanentlyInputSchema
>;

export const DeleteLessonPermanentlyOutputSchema = LessonSchema;

export type IDeleteLessonPermanentlyOutput = z.output<
  typeof DeleteLessonPermanentlyOutputSchema
>;

export const ReorderLessonsInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonIds: z.array(z.string()).min(1),
});

export type IReorderLessonsInput = z.output<typeof ReorderLessonsInputSchema>;

// The module's lessons that aren't archived, in their new order.
export const ReorderLessonsOutputSchema = z.array(LessonSchema);

export type IReorderLessonsOutput = z.output<typeof ReorderLessonsOutputSchema>;
