/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isValidTiptapDocument } from '@discava/common-tiptap';
import { z } from 'zod';
import { AssignmentContentItemSchema } from './content-item.js';
import { LessonSchema } from './lesson.js';
import { quizDefinitionShape, refineQuizDefinition } from './quiz.js';

// Assignments (#102). An assignment is a lesson of kind 'assignment' in a
// module's outline, holding one content item: a quiz (graded automatically)
// or an upload assignment (graded by an instructor). Creating one writes the
// lesson and its item together.

export const MAX_ASSIGNMENT_POINTS = 1000;

const AssignmentTargetShape = {
  courseId: z.string(),
  moduleId: z.string(),
  // The assignment's title, shown in the outline.
  title: z.string().min(1).max(200),
  description: z.string().optional(),
};

const InstructionsSchema = z
  .string()
  .min(1)
  .refine(isValidTiptapDocument, 'body must be a valid Tiptap JSON document');

const MaxPointsSchema = z.number().int().min(1).max(MAX_ASSIGNMENT_POINTS);

const DueAtSchema = z.iso.datetime();

export const CreateQuizAssignmentInputSchema = z
  .object({ ...AssignmentTargetShape, ...quizDefinitionShape })
  .superRefine(refineQuizDefinition);

export type ICreateQuizAssignmentInput = z.output<
  typeof CreateQuizAssignmentInputSchema
>;

export const CreateQuizAssignmentOutputSchema = LessonSchema;

export const CreateUploadAssignmentInputSchema = z.object({
  ...AssignmentTargetShape,
  body: InstructionsSchema,
  dueAt: DueAtSchema.optional(),
  maxPoints: MaxPointsSchema,
});

export type ICreateUploadAssignmentInput = z.output<
  typeof CreateUploadAssignmentInputSchema
>;

export const CreateUploadAssignmentOutputSchema = LessonSchema;

// `dueAt: null` removes the due date.
export const UpdateContentItemAssignmentInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
  body: InstructionsSchema.optional(),
  dueAt: DueAtSchema.nullable().optional(),
  maxPoints: MaxPointsSchema.optional(),
});

export type IUpdateContentItemAssignmentInput = z.output<
  typeof UpdateContentItemAssignmentInputSchema
>;

export const UpdateContentItemAssignmentOutputSchema =
  AssignmentContentItemSchema;

export type IUpdateContentItemAssignmentOutput = z.output<
  typeof UpdateContentItemAssignmentOutputSchema
>;
