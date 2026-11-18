/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  isValidTiptapDocument,
  plainTextExcerpt,
} from '@discava/common-tiptap';
import { z } from 'zod';

// Announcements to a course's students (specs/20261115-210422-announcements/
// contracts/instructor-api-announcement.md). The limits are core-table's
// (helpers/announcement.ts), which checks them again before writing.

const TitleSchema = z.string().trim().min(1).max(120);

const BodySchema = z
  .string()
  .max(20_000)
  .refine(isValidTiptapDocument, 'body must be a valid Tiptap JSON document')
  .refine(
    (body) => plainTextExcerpt(body, 1) !== '',
    'body must have some text',
  );

export const AnnouncementSchema = z.object({
  announcementId: z.string(),
  courseId: z.string(),
  title: z.string(),
  body: z.string(),
  authorId: z.string(),
  // "Given Family", or "Instructor" for an author with no name.
  authorName: z.string(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  version: z.number().int().min(1),
});

export type IAnnouncement = z.output<typeof AnnouncementSchema>;

export const CreateAnnouncementInputSchema = z.object({
  courseId: z.string().min(1),
  // A UUID v7 minted by the caller when the form opens; a retry sends the
  // same one, so a post is made once however often it is sent.
  announcementId: z.uuidv7(),
  title: TitleSchema,
  body: BodySchema,
});

export type ICreateAnnouncementInput = z.output<
  typeof CreateAnnouncementInputSchema
>;

export const CreateAnnouncementOutputSchema = AnnouncementSchema;

export const ListAnnouncementsInputSchema = z.object({
  courseId: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export type IListAnnouncementsInput = z.output<
  typeof ListAnnouncementsInputSchema
>;

export const ListAnnouncementsOutputSchema = z.object({
  items: z.array(AnnouncementSchema),
  cursor: z.string().optional(),
});

export type IListAnnouncementsOutput = z.output<
  typeof ListAnnouncementsOutputSchema
>;

export const UpdateAnnouncementInputSchema = z
  .object({
    courseId: z.string().min(1),
    announcementId: z.string().min(1),
    // The version the caller read; the edit applies only if it is still current.
    version: z.number().int().min(1),
    title: TitleSchema.optional(),
    body: BodySchema.optional(),
  })
  .refine(
    (input) => input.title !== undefined || input.body !== undefined,
    'an edit needs a title or a body',
  );

export type IUpdateAnnouncementInput = z.output<
  typeof UpdateAnnouncementInputSchema
>;

export const UpdateAnnouncementOutputSchema = AnnouncementSchema;

export const DeleteAnnouncementInputSchema = z.object({
  courseId: z.string().min(1),
  announcementId: z.string().min(1),
});

export type IDeleteAnnouncementInput = z.output<
  typeof DeleteAnnouncementInputSchema
>;

export const DeleteAnnouncementOutputSchema = z.object({
  announcementId: z.string(),
});
