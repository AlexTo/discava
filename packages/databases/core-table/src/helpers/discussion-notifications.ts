/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import {
  type NotificationTransactionItems,
  notificationWrites,
} from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

export const DISCUSSION_EXCERPT_MAX = 140;

/** The parts of a stored post the notifications read. */
export interface DiscussionNotificationPost {
  courseId: string;
  lessonId: string;
  threadId: string;
  postId: string;
  authorId: string;
  authorName: string;
  body?: string;
  state: 'shown' | 'hidden' | 'deleted';
  createdAt: string;
}

export type DiscussionNotificationEvent =
  | {
      kind: 'reply';
      reply: DiscussionNotificationPost;
      question: DiscussionNotificationPost;
    }
  | {
      kind: 'accepted';
      question: DiscussionNotificationPost;
      reply: DiscussionNotificationPost;
      acceptedBy: string;
      /** The acceptor's name, for `discussion.answered`. */
      acceptedByName: string;
      at: string;
    };

/** The first 140 characters as plain text, with an ellipsis when cut. */
export const discussionExcerpt = (body: string | undefined): string => {
  const text = (body ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length <= DISCUSSION_EXCERPT_MAX
    ? text
    : `${chars.slice(0, DISCUSSION_EXCERPT_MAX - 1).join('')}…`;
};

/**
 * The notification items a `reply` or `accept` adds to its `discussionWrites`
 * transaction (at most two). Nobody is told of their own action, and nothing
 * is written for a question or reply that is not shown. A repeat cancels on
 * the notification create, and the caller reads again and finds it done.
 */
export const discussionNotificationWrites = async (
  service: CoreTable,
  event: DiscussionNotificationEvent,
): Promise<NotificationTransactionItems> => {
  const { question, reply } = event;
  if (question.state !== 'shown' || reply.state !== 'shown') {
    return [];
  }
  const where = { courseId: question.courseId, lessonId: question.lessonId };
  const excerpt = discussionExcerpt(reply.body);

  if (event.kind === 'reply') {
    if (reply.authorId === question.authorId) {
      return [];
    }
    return notificationWrites(service, {
      type: 'discussion.reply',
      userId: question.authorId,
      params: { ...where, authorName: reply.authorName, excerpt },
      dedupeKey: reply.postId,
      occurredAt: reply.createdAt,
    });
  }

  const dedupeKey = `${question.threadId}:${reply.postId}`;
  const items: NotificationTransactionItems = [];
  if (reply.authorId !== event.acceptedBy) {
    items.push(
      ...(await notificationWrites(service, {
        type: 'discussion.accepted',
        userId: reply.authorId,
        params: { ...where, excerpt },
        dedupeKey,
        occurredAt: event.at,
      })),
    );
  }
  // One transaction cannot update a user's notificationState twice: when the
  // asker wrote the accepted reply, the `accepted` item above is their one.
  if (
    question.authorId !== event.acceptedBy &&
    question.authorId !== reply.authorId
  ) {
    items.push(
      ...(await notificationWrites(service, {
        type: 'discussion.answered',
        userId: question.authorId,
        params: { ...where, authorName: event.acceptedByName, excerpt },
        dedupeKey,
        occurredAt: event.at,
      })),
    );
  }
  return items;
};
