/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { LESSON_FILE_MAX_BYTES } from '@discava/common-server-utils/lesson-files';
import { isValidTiptapDocument } from '@discava/common-tiptap';
import { isCaptionLanguage } from '@discava/common-web-utils/caption-languages';
import { reportedCaptionsStatus } from '@discava/core-table';
import { z } from 'zod';
import {
  MAX_VIDEO_QUESTIONS,
  QuizAnswerKeySchema,
  QuizQuestionSchema,
  QuizSettingsSchema,
  quizDefinitionShape,
  refineQuizDefinition,
  VideoQuestionInputSchema,
  VideoQuestionSchema,
} from './quiz.js';
import { CurriculumVisibilitySchema } from './visibility.js';

export const ContentItemStatusSchema = z.enum(['pending', 'ready', 'failed']);

export const CaptionsStatusSchema = z.enum(['pending', 'ready', 'failed']);

// A video record as stored holds its caption tracks (with S3 keys) and the
// raw status; its output carries only the summary the row needs. Wrapped
// around the schemas that can return a video, ahead of their parse.
const withCaptionSummary = <S extends z.ZodType>(schema: S) =>
  z.preprocess((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      (item as { type?: unknown }).type !== 'video'
    ) {
      return item;
    }
    const video = item as {
      captionTracks?: unknown[];
      captionsStatus?: string;
      captionsPendingSince?: string;
    };
    const captionsStatus = reportedCaptionsStatus(video);
    return {
      ...video,
      ...(captionsStatus && { captionsStatus }),
      ...(video.captionTracks && {
        captionTrackCount: video.captionTracks.length,
      }),
    };
  }, schema);

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
  // For the row's caption badge: the automatic captioning's status (a
  // pending one older than two hours is reported failed) and how many tracks
  // there are (both absent on a video never captioned). The tracks, with
  // their S3 keys, are never returned here; createVideoUrl lists them.
  captionsStatus: CaptionsStatusSchema.optional(),
  captionTrackCount: z.number().int().min(0).optional(),
  // Questions asked while the video plays or when it ends, with their key
  // and the version the editor saves against. Absent on a video that never
  // had any.
  questions: z.array(VideoQuestionSchema).optional(),
  answerKey: QuizAnswerKeySchema.optional(),
  quizVersion: z.number().optional(),
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

// A graded upload (#102): the student submits files and an instructor grades
// them. The only item in an assignment lesson, which is its title.
export const AssignmentContentItemSchema = z.object({
  ...ContentItemBaseSchema,
  type: z.literal('assignment'),
  // The instructions, as a Tiptap JSON document.
  body: z.string(),
  // A submission after this is accepted but marked late.
  dueAt: z.string().optional(),
  // What the work is graded out of.
  maxPoints: z.number(),
});

const ContentItemUnionSchema = z.discriminatedUnion('type', [
  VideoContentItemSchema,
  TextContentItemSchema,
  QuizContentItemSchema,
  FileContentItemSchema,
  AssignmentContentItemSchema,
]);

export const ContentItemSchema = withCaptionSummary(ContentItemUnionSchema);

export type IContentItem = z.output<typeof ContentItemSchema>;

export const CreateContentItemVideoUploadUrlInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  fileName: z.string().min(1),
  // Set when replacing an existing video's file, so the object key's id
  // segment names the content item being updated rather than a fresh id.
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

export const CreateContentItemVideoOutputSchema = withCaptionSummary(
  VideoContentItemSchema,
);

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

export const UpdateContentItemVideoOutputSchema = withCaptionSummary(
  VideoContentItemSchema,
);

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

// A video's questions are saved as one document, like a quiz's.
export const UpdateVideoQuestionsInputSchema = z
  .object({
    courseId: z.string(),
    moduleId: z.string(),
    lessonId: z.string(),
    contentItemId: z.string(),
    // The version the editor loaded; 0 for a video that has never had
    // questions. The save is refused with CONFLICT if it has moved on.
    quizVersion: z.number().int().min(0),
    questions: z.array(VideoQuestionInputSchema).max(MAX_VIDEO_QUESTIONS),
    answerKey: QuizAnswerKeySchema,
  })
  .superRefine(refineQuizDefinition);

export type IUpdateVideoQuestionsInput = z.output<
  typeof UpdateVideoQuestionsInputSchema
>;

export const UpdateVideoQuestionsOutputSchema = withCaptionSummary(
  VideoContentItemSchema,
);

export type IUpdateVideoQuestionsOutput = z.output<
  typeof UpdateVideoQuestionsOutputSchema
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
  // The played manifest's nonce: the version the tracks belong to.
  versionId: z.string(),
  // The automatic captioning's status; absent before the video's first
  // captioning starts. A pending one older than two hours reads as failed.
  captionsStatus: CaptionsStatusSchema.optional(),
  // The tracks of this version, default first.
  captions: z.array(
    z.object({
      trackId: z.string(),
      language: z.string(),
      label: z.string(),
      isDefault: z.boolean(),
      source: z.enum(['auto', 'uploaded']),
      // Plain CloudFront URL under the version's folder, authorised by the
      // signed cookies set with this response.
      url: z.string(),
    }),
  ),
});

export type ICreateContentItemVideoUrlOutput = z.output<
  typeof CreateContentItemVideoUrlOutputSchema
>;

const CaptionItemRefSchema = {
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
  contentItemId: z.string(),
};

export const CaptionTrackOutputSchema = z.object({
  trackId: z.string(),
  language: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  source: z.enum(['auto', 'uploaded']),
});

// A video's tracks, with no S3 keys.
export const CaptionTracksOutputSchema = z.object({
  captions: z.array(CaptionTrackOutputSchema),
});

export type ICaptionTracksOutput = z.output<typeof CaptionTracksOutputSchema>;

export const CaptionUploadUrlInputSchema = z.object(CaptionItemRefSchema);

export const CaptionUploadUrlOutputSchema = z.object({
  uploadId: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
});

export const AttachCaptionInputSchema = z.object({
  ...CaptionItemRefSchema,
  uploadId: z.uuid(),
  language: z.string().refine(isCaptionLanguage, 'Choose a listed language'),
  // Plain text, shown in the player's captions menu.
  label: z.string().trim().min(1).max(40).optional(),
});

export type IAttachCaptionInput = z.output<typeof AttachCaptionInputSchema>;

export const RemoveCaptionInputSchema = z.object({
  ...CaptionItemRefSchema,
  trackId: z.string(),
});

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
