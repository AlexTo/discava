/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isValidTiptapDocument } from '@discava/common-tiptap';
import { z } from 'zod';
import {
  QuizAnswerKeySchema,
  QuizQuestionSchema,
  QuizSettingsSchema,
  quizDefinitionShape,
  refineQuizDefinition,
} from './quiz.js';
import { CurriculumVisibilitySchema } from './visibility.js';

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
  publishedAt: z.string().optional(),
  studentActivityCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const VideoContentItemSchema = z.object({
  ...ContentItemBaseSchema,
  type: z.literal('video'),
  s3Key: z.string(),
  // The version students keep playing while a replacement transcodes, or
  // after it failed (#209).
  previousS3Key: z.string().optional(),
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

// A document students download (#102): slides, a worksheet, a dataset.
export const FileContentItemSchema = z.object({
  ...ContentItemBaseSchema,
  type: z.literal('file'),
  // In the lesson media bucket.
  s3Key: z.string(),
  // The name it was uploaded with, which downloads are saved under.
  fileName: z.string(),
  // In bytes.
  fileSize: z.number(),
  mimeType: z.string(),
});

export const ContentItemSchema = z.discriminatedUnion('type', [
  VideoContentItemSchema,
  TextContentItemSchema,
  QuizContentItemSchema,
  FileContentItemSchema,
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
  body: z
    .string()
    .min(1)
    .refine(isValidTiptapDocument, 'body must be a valid Tiptap JSON document'),
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
    .refine(isValidTiptapDocument, 'body must be a valid Tiptap JSON document')
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
  // Whether the player must send credentials for it: the signed CloudFront
  // cookies set alongside. Not in local dev, where S3Mock serves the video
  // unsigned and refuses credentialed cross-origin requests (#137).
  withCredentials: z.boolean(),
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

// The ids of every content item in the lesson that isn't archived, in the order
// they should appear. The whole list travels together, so one drag in the
// editor is one atomic write and a client that doesn't know about an item that
// was added or archived in the meantime is told so, not left to guess.
export const ReorderContentItemsInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemIds: z.array(z.string()).min(1),
});

export type IReorderContentItemsInput = z.output<
  typeof ReorderContentItemsInputSchema
>;

// The lesson's content items that aren't archived, in their new order.
export const ReorderContentItemsOutputSchema = z.array(ContentItemSchema);

export type IReorderContentItemsOutput = z.output<
  typeof ReorderContentItemsOutputSchema
>;

// What a file item may be (#102), by extension: documents, spreadsheets,
// slides, plain text and images, and zip archives. Not HTML or anything
// executable: files are served from the lesson media domain. The portal's
// file picker offers the same list.
export const LESSON_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  zip: 'application/zip',
};

export const LESSON_FILE_MAX_BYTES = 100 * 1024 * 1024;

const FileNameSchema = z.string().trim().min(1).max(255);

export const CreateContentItemFileUploadUrlInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  fileName: FileNameSchema,
  // Signed into the upload URL, so the upload has to be exactly this size.
  fileSize: z.number().int().positive().max(LESSON_FILE_MAX_BYTES),
  // Set when replacing an existing file item's file.
  contentItemId: z.string().optional(),
});

export type ICreateContentItemFileUploadUrlInput = z.output<
  typeof CreateContentItemFileUploadUrlInputSchema
>;

export const CreateContentItemFileUploadUrlOutputSchema = z.object({
  contentItemId: z.string(),
  uploadUrl: z.string(),
  // The headers the upload must be sent with (they're signed).
  headers: z.record(z.string(), z.string()),
  objectKey: z.string(),
});

export type ICreateContentItemFileUploadUrlOutput = z.output<
  typeof CreateContentItemFileUploadUrlOutputSchema
>;

export const CreateContentItemFileInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  objectKey: z.string(),
  fileName: FileNameSchema,
});

export type ICreateContentItemFileInput = z.output<
  typeof CreateContentItemFileInputSchema
>;

export const CreateContentItemFileOutputSchema = FileContentItemSchema;

export type ICreateContentItemFileOutput = z.output<
  typeof CreateContentItemFileOutputSchema
>;

export const UpdateContentItemFileInputSchema = z
  .object({
    courseId: z.string(),
    moduleId: z.string(),
    lessonId: z.string(),
    contentItemId: z.string(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    // A new file, uploaded with createFileUploadUrl; both or neither.
    objectKey: z.string().optional(),
    fileName: FileNameSchema.optional(),
  })
  .refine(
    ({ objectKey, fileName }) =>
      (objectKey === undefined) === (fileName === undefined),
    'objectKey and fileName go together',
  );

export type IUpdateContentItemFileInput = z.output<
  typeof UpdateContentItemFileInputSchema
>;

export const UpdateContentItemFileOutputSchema = FileContentItemSchema;

export type IUpdateContentItemFileOutput = z.output<
  typeof UpdateContentItemFileOutputSchema
>;

export const CreateContentItemFileUrlInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
});

export type ICreateContentItemFileUrlInput = z.output<
  typeof CreateContentItemFileUrlInputSchema
>;

// A short-lived link to download the file.
export const CreateContentItemFileUrlOutputSchema = z.object({
  url: z.string(),
});

export type ICreateContentItemFileUrlOutput = z.output<
  typeof CreateContentItemFileUrlOutputSchema
>;
