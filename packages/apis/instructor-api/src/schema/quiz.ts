/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { isValidTiptapDocument } from '../lib/tiptap-document.js';

export const MAX_QUIZ_QUESTIONS = 50;
export const MIN_QUESTION_OPTIONS = 2;
export const MAX_QUESTION_OPTIONS = 10;

// A DynamoDB item is capped at 400 KB. The questions and answer key are the
// bulk of a quiz item, so their combined JSON size is bounded well under it.
export const MAX_QUIZ_CONTENT_BYTES = 300 * 1024;

// A Tiptap document, stored as a JSON string like a text item's body, that
// conforms to the editor's schema.
const TiptapJsonSchema = z
  .string()
  .max(20_000)
  .refine(isValidTiptapDocument, 'must be a valid Tiptap JSON document');

export const QuizQuestionKindSchema = z.enum(['single', 'multiple']);

export const QuizOptionSchema = z.object({
  optionId: z.string().min(1),
  text: z.string().trim().min(1).max(500),
});

export const QuizQuestionSchema = z.object({
  questionId: z.string().min(1),
  kind: QuizQuestionKindSchema,
  prompt: TiptapJsonSchema,
  options: z
    .array(QuizOptionSchema)
    .min(MIN_QUESTION_OPTIONS)
    .max(MAX_QUESTION_OPTIONS),
});

export type IQuizQuestion = z.output<typeof QuizQuestionSchema>;

export const QuizAnswerKeyEntrySchema = z.object({
  correctOptionIds: z.array(z.string().min(1)),
  explanation: TiptapJsonSchema.optional(),
});

export const QuizAnswerKeySchema = z.record(
  z.string(),
  QuizAnswerKeyEntrySchema,
);

export type IQuizAnswerKey = z.output<typeof QuizAnswerKeySchema>;

export const QuizSettingsSchema = z.object({
  passMarkPercent: z.number().int().min(0).max(100),
  // null = unlimited
  attemptsAllowed: z.number().int().min(1).nullable(),
  shuffleOptions: z.boolean(),
  revealAnswers: z.enum(['after_each_attempt', 'after_final_attempt', 'never']),
});

export type IQuizSettings = z.output<typeof QuizSettingsSchema>;

// The part of a quiz an instructor edits as one document: the questions, the
// key that grades them, and the settings. Input schemas spread this shape and
// apply `refineQuizDefinition`, so create and update enforce the same
// cross-field rules.
export const quizDefinitionShape = {
  questions: z.array(QuizQuestionSchema).min(1).max(MAX_QUIZ_QUESTIONS),
  answerKey: QuizAnswerKeySchema,
  settings: QuizSettingsSchema,
};

export type IQuizDefinition = z.output<
  ReturnType<typeof z.object<typeof quizDefinitionShape>>
>;

export const refineQuizDefinition = (
  { questions, answerKey }: Pick<IQuizDefinition, 'questions' | 'answerKey'>,
  ctx: z.RefinementCtx,
) => {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: 'custom', message, path });

  const questionIds = new Set<string>();
  questions.forEach((question, questionIndex) => {
    const questionPath = ['questions', questionIndex];
    if (questionIds.has(question.questionId)) {
      issue('questionId must be unique', [...questionPath, 'questionId']);
    }
    questionIds.add(question.questionId);

    const optionIds = new Set<string>();
    question.options.forEach((option, optionIndex) => {
      if (optionIds.has(option.optionId)) {
        issue('optionId must be unique within a question', [
          ...questionPath,
          'options',
          optionIndex,
          'optionId',
        ]);
      }
      optionIds.add(option.optionId);
    });

    const entry = answerKey[question.questionId];
    if (!entry) {
      issue('every question needs an answer key entry', [
        'answerKey',
        question.questionId,
      ]);
      return;
    }
    const correct = entry.correctOptionIds;
    const keyPath = ['answerKey', question.questionId, 'correctOptionIds'];
    if (new Set(correct).size !== correct.length) {
      issue('correctOptionIds must not repeat an option', keyPath);
    }
    if (correct.some((optionId) => !optionIds.has(optionId))) {
      issue('correctOptionIds must be options of the question', keyPath);
    }
    if (question.kind === 'single' && correct.length !== 1) {
      issue('a single choice question has exactly 1 correct option', keyPath);
    }
    if (question.kind === 'multiple' && correct.length < 1) {
      issue(
        'a multiple choice question has at least 1 correct option',
        keyPath,
      );
    }
  });

  for (const questionId of Object.keys(answerKey)) {
    if (!questionIds.has(questionId)) {
      issue('answer key entry for an unknown question', [
        'answerKey',
        questionId,
      ]);
    }
  }

  if (
    Buffer.byteLength(JSON.stringify({ questions, answerKey })) >
    MAX_QUIZ_CONTENT_BYTES
  ) {
    issue('the quiz is too large', []);
  }
};
