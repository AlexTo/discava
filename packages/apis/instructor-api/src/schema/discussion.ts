/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

// specs/20261116-013334-lesson-discussions/contracts/instructor-api-discussion.md.
// DiscussionPost is core-api's, as an instructor sees it: always the content
// (a deleted post has none) and `reportCount`, never the reporters.

export const DiscussionPostSchema = z.object({
  postId: z.string(),
  threadId: z.string(),
  kind: z.enum(['question', 'reply']),
  state: z.enum(['shown', 'hidden', 'deleted']),
  authorName: z.string(),
  authorIsInstructor: z.boolean(),
  title: z.string().optional(),
  body: z.string().optional(),
  createdAt: z.string(),
  voteCount: z.number(),
  replyCount: z.number().optional(),
  accepted: z.boolean().optional(),
  answered: z.boolean().optional(),
  mine: z.boolean(),
  reportCount: z.number(),
});

export type IDiscussionPost = z.output<typeof DiscussionPostSchema>;

// The queue's rows carry their lesson's ids, which the moderation calls need.
export const QueuePostSchema = DiscussionPostSchema.extend({
  moduleId: z.string(),
  lessonId: z.string(),
  lessonTitle: z.string(),
});

export type IQueuePost = z.output<typeof QueuePostSchema>;

export const QueueInputSchema = z.object({
  courseId: z.string().min(1),
  cursor: z.string().min(1).optional(),
});

export const QueueOutputSchema = z.object({
  items: z.array(QueuePostSchema),
  cursor: z.string().optional(),
});

export const ModerateInputSchema = z.object({
  courseId: z.string().min(1),
  moduleId: z.string().min(1),
  lessonId: z.string().min(1),
  threadId: z.string().min(1),
  postId: z.string().min(1),
});

export const HidePostInputSchema = ModerateInputSchema;
export const UnhidePostInputSchema = ModerateInputSchema;
export const RemovePostInputSchema = ModerateInputSchema;
export const DismissReportsInputSchema = ModerateInputSchema;
