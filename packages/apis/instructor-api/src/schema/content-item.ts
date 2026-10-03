/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import {
  QuizAnswerKeySchema,
  QuizQuestionSchema,
  QuizSettingsSchema,
  quizDefinitionShape,
  refineQuizDefinition,
} from './quiz.js';
import { CurriculumVisibilitySchema } from './visibility.js';

const isValidJson = (value: string) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};

export const ContentItemStatusSchema = z.enum(['pending', 'ready', 'failed']);

const ContentItemBaseSchema = {
  contentItemId: z.string(),
  lessonId: z.string(),
  moduleId: z.string(),
  courseId: z.string(),
  status: ContentItemStatusSchema,
  title: z.string(),
  description: z.string().optional(),
  order: z.number(),
  visibility: CurriculumVisibilitySchema,
  archivedAt: z.string().optional(),
  studentActivityCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const VideoContentItemSchema = z.object({
  ...ContentItemBaseSchema,
  type: z.literal('video'),
  s3Key: z.string(),
  mimeType: z.string(),
  durationSeconds: z.number().optional(),
});

export const TextContentItemSchema = z.object({
  ...ContentItemBaseSchema,
  type: z.literal('text'),
  body: z.string(),
});

export const QuizContentItemSchema = z.object({
  ...ContentItemBaseSchema,
  type: z.literal('quiz'),
  questions: z.array(QuizQuestionSchema),
  answerKey: QuizAnswerKeySchema,
  settings: QuizSettingsSchema,
  quizVersion: z.number(),
  questionsHash: z.string(),
});

export const ContentItemSchema = z.discriminatedUnion('type', [
  VideoContentItemSchema,
  TextContentItemSchema,
  QuizContentItemSchema,
]);

export type IContentItem = z.output<typeof ContentItemSchema>;

export const CreateContentItemVideoUploadUrlInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  fileName: z.string().min(1),
  // Set when replacing an existing video's file, so the object key's id
  // segment matches the content item being updated instead of a fresh,
  // unrelated one -- the transcode pipeline parses this id straight out of
  // the S3 key.
  contentItemId: z.string().optional(),
});

export type ICreateContentItemVideoUploadUrlInput = z.output<
  typeof CreateContentItemVideoUploadUrlInputSchema
>;

export const CreateContentItemVideoUploadUrlOutputSchema = z.object({
  contentItemId: z.string(),
  uploadUrl: z.string(),
  objectKey: z.string(),
});

export type ICreateContentItemVideoUploadUrlOutput = z.output<
  typeof CreateContentItemVideoUploadUrlOutputSchema
>;

export const CreateContentItemVideoInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  objectKey: z.string(),
  mimeType: z.string(),
  durationSeconds: z.number().optional(),
});

export type ICreateContentItemVideoInput = z.output<
  typeof CreateContentItemVideoInputSchema
>;

export const CreateContentItemVideoOutputSchema = VideoContentItemSchema;

export type ICreateContentItemVideoOutput = z.output<
  typeof CreateContentItemVideoOutputSchema
>;

export const CreateContentItemTextInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  body: z.string().min(1).refine(isValidJson, 'body must be valid JSON'),
});

export type ICreateContentItemTextInput = z.output<
  typeof CreateContentItemTextInputSchema
>;

export const CreateContentItemTextOutputSchema = TextContentItemSchema;

export type ICreateContentItemTextOutput = z.output<
  typeof CreateContentItemTextOutputSchema
>;

export const UpdateContentItemVideoInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  objectKey: z.string().optional(),
  mimeType: z.string().optional(),
  durationSeconds: z.number().optional(),
});

export type IUpdateContentItemVideoInput = z.output<
  typeof UpdateContentItemVideoInputSchema
>;

export const UpdateContentItemVideoOutputSchema = VideoContentItemSchema;

export type IUpdateContentItemVideoOutput = z.output<
  typeof UpdateContentItemVideoOutputSchema
>;

export const UpdateContentItemTextInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  body: z
    .string()
    .min(1)
    .refine(isValidJson, 'body must be valid JSON')
    .optional(),
});

export type IUpdateContentItemTextInput = z.output<
  typeof UpdateContentItemTextInputSchema
>;

export const UpdateContentItemTextOutputSchema = TextContentItemSchema;

export type IUpdateContentItemTextOutput = z.output<
  typeof UpdateContentItemTextOutputSchema
>;

export const CreateContentItemQuizInputSchema = z
  .object({
    courseId: z.string(),
    moduleId: z.string(),
    lessonId: z.string(),
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    ...quizDefinitionShape,
  })
  .superRefine(refineQuizDefinition);

export type ICreateContentItemQuizInput = z.output<
  typeof CreateContentItemQuizInputSchema
>;

export const CreateContentItemQuizOutputSchema = QuizContentItemSchema;

export type ICreateContentItemQuizOutput = z.output<
  typeof CreateContentItemQuizOutputSchema
>;

// The quiz is saved as one document: questions, answer key and settings
// always travel together, so a save can't pair a new key with old questions.
// `quizVersion` is the version the client loaded, which the write is
// conditioned on, so a stale editor can't overwrite a newer save.
export const UpdateContentItemQuizInputSchema = z
  .object({
    courseId: z.string(),
    moduleId: z.string(),
    lessonId: z.string(),
    contentItemId: z.string(),
    // The version of the quiz the editor loaded. The save is refused with
    // CONFLICT if the quiz has moved on since.
    quizVersion: z.number().int().min(1),
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    ...quizDefinitionShape,
  })
  .superRefine(refineQuizDefinition);

export type IUpdateContentItemQuizInput = z.output<
  typeof UpdateContentItemQuizInputSchema
>;

export const UpdateContentItemQuizOutputSchema = QuizContentItemSchema;

export type IUpdateContentItemQuizOutput = z.output<
  typeof UpdateContentItemQuizOutputSchema
>;

export const CreateContentItemVideoUrlInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
});

export type ICreateContentItemVideoUrlInput = z.output<
  typeof CreateContentItemVideoUrlInputSchema
>;

export const CreateContentItemVideoUrlOutputSchema = z.object({
  url: z.string(),
});

export type ICreateContentItemVideoUrlOutput = z.output<
  typeof CreateContentItemVideoUrlOutputSchema
>;

export const DeleteContentItemInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
});

export type IDeleteContentItemInput = z.output<
  typeof DeleteContentItemInputSchema
>;

export const DeleteContentItemOutputSchema = ContentItemSchema;

export type IDeleteContentItemOutput = z.output<
  typeof DeleteContentItemOutputSchema
>;

const ContentItemKeySchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
});

export const PublishContentItemInputSchema = ContentItemKeySchema;

export type IPublishContentItemInput = z.output<
  typeof PublishContentItemInputSchema
>;

export const PublishContentItemOutputSchema = ContentItemSchema;

export type IPublishContentItemOutput = z.output<
  typeof PublishContentItemOutputSchema
>;

export const HideContentItemInputSchema = ContentItemKeySchema;

export type IHideContentItemInput = z.output<typeof HideContentItemInputSchema>;

export const HideContentItemOutputSchema = ContentItemSchema;

export type IHideContentItemOutput = z.output<
  typeof HideContentItemOutputSchema
>;

export const RestoreContentItemInputSchema = ContentItemKeySchema;

export type IRestoreContentItemInput = z.output<
  typeof RestoreContentItemInputSchema
>;

export const RestoreContentItemOutputSchema = ContentItemSchema;

export type IRestoreContentItemOutput = z.output<
  typeof RestoreContentItemOutputSchema
>;

export const DeleteContentItemPermanentlyInputSchema = ContentItemKeySchema;

export type IDeleteContentItemPermanentlyInput = z.output<
  typeof DeleteContentItemPermanentlyInputSchema
>;

export const DeleteContentItemPermanentlyOutputSchema = ContentItemSchema;

export type IDeleteContentItemPermanentlyOutput = z.output<
  typeof DeleteContentItemPermanentlyOutputSchema
>;
