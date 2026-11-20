/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// The notification types a producer can publish: the public contract of the
// notification pipeline. Adding a type is one entry here plus a test; nothing
// else changes. Producers publish through core-table's notification helpers,
// which build the stored title, body and link with buildNotification.

export type NotificationPortal = 'student' | 'instructor' | 'admin';

export type EmailPolicy = 'default-on' | 'default-off' | 'required' | 'never';

export interface NotificationType<P extends string = string> {
  /** Stable, '<area>.<event>'. */
  id: string;
  /** Settings label. */
  name: string;
  /** Settings text. */
  description: string;
  /** Required flat string params. */
  params: readonly P[];
  emailPolicy: EmailPolicy;
  /** Pure and total over valid params. */
  build(params: Record<P, string>): {
    title: string;
    body: string;
    link: { portal: NotificationPortal; path: string };
  };
}

/** A producer's input was invalid: unknown type, bad param, bad key or time. */
export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationInputError';
  }
}

const defineType = <P extends string>(type: NotificationType<P>) => type;

export const NOTIFICATION_TYPES: Record<string, NotificationType> = {
  'assignment.returned': defineType({
    id: 'assignment.returned',
    name: 'Assignment returned',
    description: 'An instructor returns your assignment submission.',
    params: ['courseId', 'lessonId', 'assignmentTitle', 'courseTitle'],
    emailPolicy: 'default-on',
    build: (p) => ({
      title: `Your assignment "${p.assignmentTitle}" was returned`,
      body: `Your submission to "${p.assignmentTitle}" in ${p.courseTitle} has been returned.`,
      link: {
        portal: 'student',
        path: `/learn/${p.courseId}/lesson/${p.lessonId}`,
      },
    }),
  }),
  'announcement.posted': defineType({
    id: 'announcement.posted',
    name: 'Course announcements',
    description: 'An instructor posts an announcement to a course you are in.',
    params: ['courseId', 'courseTitle', 'announcementTitle', 'excerpt'],
    emailPolicy: 'default-on',
    build: (p) => ({
      title: `${p.courseTitle}: ${p.announcementTitle}`,
      body: p.excerpt,
      link: { portal: 'student', path: `/learn/${p.courseId}/home` },
    }),
  }),
  'discussion.reply': defineType({
    id: 'discussion.reply',
    name: 'Discussion replies',
    description: 'Someone replies to your post in a lesson discussion.',
    params: ['courseId', 'lessonId', 'authorName', 'excerpt'],
    emailPolicy: 'default-on',
    build: (p) => ({
      title: `${p.authorName} replied to your post`,
      body: p.excerpt,
      link: {
        portal: 'student',
        path: `/learn/${p.courseId}/lesson/${p.lessonId}`,
      },
    }),
  }),
  'discussion.answered': defineType({
    id: 'discussion.answered',
    name: 'Answered questions',
    description: 'Someone marks an answer to your question in a lesson.',
    params: ['courseId', 'lessonId', 'authorName', 'excerpt'],
    emailPolicy: 'default-on',
    build: (p) => ({
      title: `${p.authorName} marked an answer to your question`,
      body: p.excerpt,
      link: {
        portal: 'student',
        path: `/learn/${p.courseId}/lesson/${p.lessonId}`,
      },
    }),
  }),
  'discussion.accepted': defineType({
    id: 'discussion.accepted',
    name: 'Accepted answers',
    description: 'Your reply in a lesson discussion is marked as the answer.',
    params: ['courseId', 'lessonId', 'excerpt'],
    emailPolicy: 'default-off',
    build: (p) => ({
      title: 'Your reply was marked as the answer',
      body: p.excerpt,
      link: {
        portal: 'student',
        path: `/learn/${p.courseId}/lesson/${p.lessonId}`,
      },
    }),
  }),
  'order.refunded': defineType({
    id: 'order.refunded',
    name: 'Refunds',
    description: 'A refund of a course you bought has gone through.',
    params: ['courseTitle', 'courseId', 'amount'],
    emailPolicy: 'required',
    build: (p) => ({
      title: `Your refund for ${p.courseTitle} is complete`,
      body: `${p.amount} has been refunded for ${p.courseTitle}, and your access to the course has ended.`,
      link: { portal: 'student', path: `/learn/${p.courseId}` },
    }),
  }),
  'review.received': defineType({
    id: 'review.received',
    name: 'Course reviews',
    description: 'A student reviews one of your courses.',
    params: ['courseId', 'courseTitle', 'rating'],
    emailPolicy: 'default-off',
    build: (p) => ({
      title: `New review for ${p.courseTitle}`,
      body: `A student rated ${p.courseTitle} ${p.rating} out of 5.`,
      link: { portal: 'instructor', path: `/my-courses/${p.courseId}/reviews` },
    }),
  }),
};

export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 500;

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * Builds a notification's stored title, body and link from a type's params,
 * throwing NotificationInputError when the type is unknown or a required
 * param isn't a non-empty string. Params the type doesn't declare are
 * ignored.
 */
export const buildNotification = (
  type: string,
  params: Record<string, unknown>,
): {
  title: string;
  body: string;
  link: { portal: NotificationPortal; path: string };
} => {
  const entry = Object.hasOwn(NOTIFICATION_TYPES, type)
    ? NOTIFICATION_TYPES[type]
    : undefined;
  if (!entry) {
    throw new NotificationInputError(`Unknown notification type "${type}"`);
  }
  const declared: Record<string, string> = {};
  for (const name of entry.params) {
    const value = params[name];
    if (typeof value !== 'string' || value === '') {
      throw new NotificationInputError(
        `Notification type "${type}" needs a non-empty string param "${name}"`,
      );
    }
    declared[name] = value;
  }
  const { title, body, link } = entry.build(declared);
  return {
    title: truncate(title, MAX_TITLE_LENGTH),
    body: truncate(body, MAX_BODY_LENGTH),
    link,
  };
};
