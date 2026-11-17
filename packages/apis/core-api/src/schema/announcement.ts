/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// specs/20261115-210422-announcements/contracts/core-api-announcement.md:
// what an enrolled student reads. Unlike instructor-api's, no `authorId` or
// `version`.

export const AnnouncementItemSchema = z.object({
  announcementId: z.string(),
  courseId: z.string(),
  title: z.string(),
  // A Tiptap JSON document.
  body: z.string(),
  // "Given Family", or "Instructor" for an author with no name.
  authorName: z.string(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
});

export type IAnnouncementItem = z.output<typeof AnnouncementItemSchema>;

export const ListAnnouncementsInputSchema = z.object({
  courseId: z.string().min(1),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export const ListAnnouncementsOutputSchema = z.object({
  items: z.array(AnnouncementItemSchema),
  cursor: z.string().optional(),
});

export type IListAnnouncementsOutput = z.output<
  typeof ListAnnouncementsOutputSchema
>;
