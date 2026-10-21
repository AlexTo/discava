/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { ContentItemSchema } from './content-item.js';
import { LessonSchema } from './lesson.js';
import { ModuleSchema } from './module.js';

export const CourseStatusSchema = z.enum(['draft', 'published', 'archived']);

export const CreateCourseInputSchema = z.object({
  title: z.string().min(1).max(200),
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

export const ViewCourseInputSchema = z.object({
  courseId: z.string(),
});

export type IViewCourseInput = z.output<typeof ViewCourseInputSchema>;

// The instructor's view of a course: the whole curriculum, including hidden
// and archived records (with their visibility/archivedAt), which the
// student-facing core-api course.view filters out.
export const ViewCourseOutputSchema = CourseSchema.extend({
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
