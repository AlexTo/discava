/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { ContentItemRefSchema } from './completion.js';

export const ViewVideoQuestionsInputSchema = ContentItemRefSchema;

// The questions a learner is asked in a video, in the order they are asked.
// Never the answer key: a question's correct options and explanation appear
// only inside `answers`, for the questions the caller has answered.
export const ViewVideoQuestionsOutputSchema = z.object({
  quizVersion: z.number(),
  questions: z.array(
    z.object({
      questionId: z.string(),
      kind: z.enum(['single', 'multiple']),
      // Tiptap JSON.
      prompt: z.string(),
      options: z.array(z.object({ optionId: z.string(), text: z.string() })),
      atSeconds: z.number().int().min(0).nullable(),
      contentHash: z.string(),
    }),
  ),
  // The caller's recorded answers to the questions above, by questionId.
  answers: z.record(
    z.string(),
    z.object({
      optionIds: z.array(z.string()),
      correct: z.boolean(),
      answeredAt: z.string(),
      correctOptionIds: z.array(z.string()),
      // Tiptap JSON.
      explanation: z.string().optional(),
    }),
  ),
});

export type IViewVideoQuestionsOutput = z.output<
  typeof ViewVideoQuestionsOutputSchema
>;

export const AnswerVideoQuestionInputSchema = ContentItemRefSchema.extend({
  questionId: z.string().min(1),
  optionIds: z.array(z.string().min(1)).min(1).max(10),
  // The contentHash of the question as the player showed it.
  contentHash: z.string().min(1),
});

export type IAnswerVideoQuestionInput = z.output<
  typeof AnswerVideoQuestionInputSchema
>;

export const AnswerVideoQuestionOutputSchema = z.object({
  // What is on record.
  optionIds: z.array(z.string()),
  correct: z.boolean(),
  answeredAt: z.string(),
  correctOptionIds: z.array(z.string()),
  explanation: z.string().optional(),
  // False when the question was already answered and this is that record.
  recorded: z.boolean(),
});

export type IAnswerVideoQuestionOutput = z.output<
  typeof AnswerVideoQuestionOutputSchema
>;
