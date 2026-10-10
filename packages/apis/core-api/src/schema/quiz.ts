/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// Where a quiz sits in the curriculum: a content item's full key.
export const QuizRefSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
});

export type IQuizRef = z.output<typeof QuizRefSchema>;

// Questions as students see them. `prompt` is a Tiptap JSON string.
export const QuizQuestionSchema = z.object({
  questionId: z.string(),
  kind: z.enum(['single', 'multiple']),
  prompt: z.string(),
  options: z.array(z.object({ optionId: z.string(), text: z.string() })),
});

export type IQuizQuestion = z.output<typeof QuizQuestionSchema>;

export const QuizSettingsSchema = z.object({
  passMarkPercent: z.number(),
  // null = unlimited
  attemptsAllowed: z.number().nullable(),
  shuffleOptions: z.boolean(),
  revealAnswers: z.enum(['after_each_attempt', 'after_final_attempt', 'never']),
});

export type IQuizSettings = z.output<typeof QuizSettingsSchema>;

// The stored answer key's shape. Never part of an output schema: only the
// correct options and explanations of a revealed quiz are returned, as
// QuizRevealSchema.
export type IQuizAnswerKey = Record<
  string,
  { correctOptionIds: string[]; explanation?: string }
>;

export const ViewQuizInputSchema = QuizRefSchema;

export type IViewQuizInput = z.output<typeof ViewQuizInputSchema>;

// Deliberately without `answerKey`: this output is stripped to the fields
// below, so the key can't leak however the quiz is read.
export const ViewQuizOutputSchema = QuizRefSchema.extend({
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  questions: z.array(QuizQuestionSchema),
  settings: QuizSettingsSchema,
  quizVersion: z.number(),
  // Sent back with each submission, so an attempt at questions that have
  // since changed is refused instead of graded.
  questionsHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IViewQuizOutput = z.output<typeof ViewQuizOutputSchema>;

// { [questionId]: optionId[] }. A question left out, or with no options
// selected, is unanswered and graded incorrect.
export const QuizAnswersSchema = z.record(
  z.string(),
  z.array(z.string()).max(10),
);

export type IQuizAnswers = z.output<typeof QuizAnswersSchema>;

export const SubmitQuizAttemptInputSchema = QuizRefSchema.extend({
  // The questionsHash of the questions the student answered, from quiz.view.
  questionsHash: z.string(),
  answers: QuizAnswersSchema,
});

export type ISubmitQuizAttemptInput = z.output<
  typeof SubmitQuizAttemptInputSchema
>;

export const QuizAttemptSchema = z.object({
  attemptId: z.string(),
  answers: QuizAnswersSchema,
  correctQuestionIds: z.array(z.string()),
  scorePercent: z.number(),
  passed: z.boolean(),
  quizVersion: z.number(),
  questionsHash: z.string(),
  submittedAt: z.string(),
});

export type IQuizAttempt = z.output<typeof QuizAttemptSchema>;

export const QuizSummarySchema = z.object({
  attemptsUsed: z.number(),
  // From the quiz's current settings; null = unlimited.
  attemptsAllowed: z.number().nullable(),
  bestScore: z.number(),
  bestAttemptId: z.string(),
  passedAt: z.string().optional(),
});

export type IQuizSummary = z.output<typeof QuizSummarySchema>;

// The correct options and explanations, per question of the current quiz.
// Only returned once the quiz's `revealAnswers` setting allows it.
export const QuizRevealSchema = z.record(
  z.string(),
  z.object({
    correctOptionIds: z.array(z.string()),
    explanation: z.string().optional(),
  }),
);

export type IQuizReveal = z.output<typeof QuizRevealSchema>;

export const SubmitQuizAttemptOutputSchema = z.object({
  attempt: QuizAttemptSchema,
  summary: QuizSummarySchema,
  reveal: QuizRevealSchema.nullable(),
});

export type ISubmitQuizAttemptOutput = z.output<
  typeof SubmitQuizAttemptOutputSchema
>;

export const MyQuizAttemptsInputSchema = QuizRefSchema;

export type IMyQuizAttemptsInput = z.output<typeof MyQuizAttemptsInputSchema>;

export const MyQuizAttemptsOutputSchema = z.object({
  // null until the first attempt.
  summary: QuizSummarySchema.nullable(),
  // Oldest first.
  attempts: z.array(QuizAttemptSchema),
  reveal: QuizRevealSchema.nullable(),
});

export type IMyQuizAttemptsOutput = z.output<typeof MyQuizAttemptsOutputSchema>;
