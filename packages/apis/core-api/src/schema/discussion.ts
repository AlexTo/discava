/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { DISCUSSION_BODY_MAX, DISCUSSION_TITLE_MAX } from '@discava/core-table';
import { z } from 'zod';

// specs/20261116-013334-lesson-discussions/contracts/core-api-discussion.md.
// Text is trimmed and its length counted by the write helper, which names the
// field in its error; the limits here only stop absurdly large payloads.

export const LessonRefSchema = z.object({
  courseId: z.string().min(1),
  moduleId: z.string().min(1),
  lessonId: z.string().min(1),
});

export type ILessonRef = z.output<typeof LessonRefSchema>;

const PostRefSchema = LessonRefSchema.extend({
  threadId: z.string().min(1),
  postId: z.string().min(1),
});

export const DiscussionPostSchema = z.object({
  postId: z.string(),
  threadId: z.string(),
  kind: z.enum(['question', 'reply']),
  state: z.enum(['shown', 'hidden', 'deleted']),
  // Present only when the caller may see the post's content.
  authorName: z.string().optional(),
  authorIsInstructor: z.boolean().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  createdAt: z.string().optional(),
  voteCount: z.number().optional(),
  replyCount: z.number().optional(),
  accepted: z.boolean().optional(),
  answered: z.boolean().optional(),
  upvotedByMe: z.boolean().optional(),
  mine: z.boolean().optional(),
  // Instructors only; never the reporters.
  reportCount: z.number().optional(),
});

export type IDiscussionPost = z.output<typeof DiscussionPostSchema>;

export const ListQuestionsInputSchema = LessonRefSchema.extend({
  cursor: z.string().min(1).optional(),
});

export const ListQuestionsOutputSchema = z.object({
  items: z.array(DiscussionPostSchema),
  cursor: z.string().optional(),
});

export const ThreadInputSchema = LessonRefSchema.extend({
  threadId: z.string().min(1),
  cursor: z.string().min(1).optional(),
});

export const ThreadOutputSchema = z.object({
  question: DiscussionPostSchema,
  accepted: DiscussionPostSchema.optional(),
  replies: z.array(DiscussionPostSchema),
  cursor: z.string().optional(),
});

export const AskInputSchema = LessonRefSchema.extend({
  postId: z.string().min(1),
  title: z.string().max(DISCUSSION_TITLE_MAX * 4),
  body: z.string().max(DISCUSSION_BODY_MAX * 4),
});

export const ReplyInputSchema = PostRefSchema.extend({
  body: z.string().max(DISCUSSION_BODY_MAX * 4),
});

export const VoteInputSchema = PostRefSchema.extend({ voted: z.boolean() });

export const VoteOutputSchema = z.object({
  voteCount: z.number(),
  upvotedByMe: z.boolean(),
});

export const AcceptInputSchema = LessonRefSchema.extend({
  threadId: z.string().min(1),
  postId: z.string().min(1).nullable(),
});

export const ReportInputSchema = PostRefSchema;

export const ReportOutputSchema = z.object({ reported: z.literal(true) });

export const RemoveOwnInputSchema = PostRefSchema;
