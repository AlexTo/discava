/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LANGUAGES, LEVELS } from '@discava/core-table';
import { z } from 'zod';
import { ContentItemSchema } from './content-item.js';
import { CoursePreviewSummarySchema } from './course-preview.js';
import { LessonSchema } from './lesson.js';
import { ModuleSchema } from './module.js';

export const CourseStatusSchema = z.enum(['draft', 'published', 'archived']);

export const CreateCourseInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export type ICreateCourseInput = z.output<typeof CreateCourseInputSchema>;

export const CourseSchema = z.object({
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: CourseStatusSchema,
  publishedAt: z.string().optional(),
  imageKey: z.string().optional(),
  categoryId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  level: z.enum(LEVELS).optional(),
  language: z.enum(LANGUAGES).optional(),
  durationHours: z.number().optional(),
  learningOutcomes: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  certificatesEnabled: z.boolean(),
  // The course's own first-lesson prompt; absent when it uses the default.
  firstLessonPrompt: z.string().optional(),
  certificateCriteria: z.object({
    version: z.number(),
    requireQuizPass: z.boolean(),
    minUploadScorePercent: z.number().optional(),
  }),
  priceAmount: z.number(),
  priceCurrency: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ICourse = z.output<typeof CourseSchema>;

export const CreateCourseOutputSchema = CourseSchema;

export type ICreateCourseOutput = z.output<typeof CreateCourseOutputSchema>;

export const ArchiveCourseInputSchema = z.object({
  courseId: z.string(),
});

export type IArchiveCourseInput = z.output<typeof ArchiveCourseInputSchema>;

export const ArchiveCourseOutputSchema = CourseSchema;

export type IArchiveCourseOutput = z.output<typeof ArchiveCourseOutputSchema>;

export const PublishCourseInputSchema = z.object({
  courseId: z.string(),
});

export type IPublishCourseInput = z.output<typeof PublishCourseInputSchema>;

export const PublishCourseOutputSchema = CourseSchema;

export type IPublishCourseOutput = z.output<typeof PublishCourseOutputSchema>;

export const RestoreCourseInputSchema = z.object({
  courseId: z.string(),
});

export type IRestoreCourseInput = z.output<typeof RestoreCourseInputSchema>;

export const RestoreCourseOutputSchema = CourseSchema;

export type IRestoreCourseOutput = z.output<typeof RestoreCourseOutputSchema>;

// Comfortably above a 1280x720 JPEG at the quality the instructor portal
// crops to (a few hundred KB), while refusing anything that clearly isn't one.
export const COURSE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const CreateCourseImageUploadUrlInputSchema = z.object({
  courseId: z.string(),
  // The cropped image's exact size: the presigned URL only accepts this many
  // bytes.
  contentLength: z.number().int().positive().max(COURSE_IMAGE_MAX_BYTES),
});

export type ICreateCourseImageUploadUrlInput = z.output<
  typeof CreateCourseImageUploadUrlInputSchema
>;

export const CreateCourseImageUploadUrlOutputSchema = z.object({
  uploadUrl: z.string(),
  imageKey: z.string(),
  // Send these with the PUT exactly as given: they're part of its signature.
  headers: z.record(z.string(), z.string()),
});

export type ICreateCourseImageUploadUrlOutput = z.output<
  typeof CreateCourseImageUploadUrlOutputSchema
>;

export const UpdateCourseImageInputSchema = z.object({
  courseId: z.string(),
  // An image uploaded through createImageUploadUrl, or null to remove it.
  imageKey: z.string().nullable(),
});

export type IUpdateCourseImageInput = z.output<
  typeof UpdateCourseImageInputSchema
>;

export const UpdateCourseImageOutputSchema = CourseSchema;

export type IUpdateCourseImageOutput = z.output<
  typeof UpdateCourseImageOutputSchema
>;

export const SetCourseCertificatesInputSchema = z.object({
  courseId: z.string(),
  enabled: z.boolean(),
});

export type ISetCourseCertificatesInput = z.output<
  typeof SetCourseCertificatesInputSchema
>;

export const SetCourseCertificatesOutputSchema = CourseSchema;

export type ISetCourseCertificatesOutput = z.output<
  typeof SetCourseCertificatesOutputSchema
>;

// The limit is checked by normaliseFirstLessonPrompt, so that an over-long
// text gets its own message. This one only bounds what the API will read.
export const SetCourseFirstLessonPromptInputSchema = z.object({
  courseId: z.string(),
  prompt: z.string().max(800).nullable(),
});

export type ISetCourseFirstLessonPromptInput = z.output<
  typeof SetCourseFirstLessonPromptInputSchema
>;

export const SetCourseFirstLessonPromptOutputSchema = CourseSchema;

export type ISetCourseFirstLessonPromptOutput = z.output<
  typeof SetCourseFirstLessonPromptOutputSchema
>;

export const SetCertificateCriteriaInputSchema = z
  .object({
    courseId: z.string(),
    requireQuizPass: z.boolean(),
    // A whole percent from 1 to 100; null removes the requirement, and
    // leaving it out keeps the stored value.
    minUploadScorePercent: z.number().int().min(1).max(100).nullish(),
  })
  .strict();

export type ISetCertificateCriteriaInput = z.output<
  typeof SetCertificateCriteriaInputSchema
>;

export const SetCertificateCriteriaOutputSchema = CourseSchema;

export type ISetCertificateCriteriaOutput = z.output<
  typeof SetCertificateCriteriaOutputSchema
>;

export const SetCoursePriceInputSchema = z.object({
  courseId: z.string(),
  priceAmount: z.number(),
  priceCurrency: z.string(),
});

export type ISetCoursePriceInput = z.output<typeof SetCoursePriceInputSchema>;

export const SetCoursePriceOutputSchema = CourseSchema;

export type ISetCoursePriceOutput = z.output<typeof SetCoursePriceOutputSchema>;

export const ViewCourseInputSchema = z.object({
  courseId: z.string(),
});

export type IViewCourseInput = z.output<typeof ViewCourseInputSchema>;

// The instructor's view of a course: the whole curriculum, including hidden
// and archived records (with their visibility/archivedAt), which the
// student-facing core-api course.view filters out.
export const ViewCourseOutputSchema = CourseSchema.extend({
  // The text new learners see when the course has no prompt of its own.
  defaultFirstLessonPrompt: z.string(),
  // The course's category by name, archived or not, so the editor can show
  // one that is no longer in the active list.
  category: z
    .object({ id: z.string(), name: z.string(), archived: z.boolean() })
    .optional(),
  // Absent when the course has no preview video.
  preview: CoursePreviewSummarySchema.optional(),
  modules: z.array(
    ModuleSchema.extend({
      lessons: z.array(
        LessonSchema.extend({
          contentItems: z.array(ContentItemSchema),
        }),
      ),
    }),
  ),
});

export type IViewCourseOutput = z.output<typeof ViewCourseOutputSchema>;
