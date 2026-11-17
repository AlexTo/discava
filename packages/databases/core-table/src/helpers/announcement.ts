/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { notifyCourseStudents, transactionEntities } from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];

// An instructor's announcement to a course's students. The only writer of
// `announcement`: every writer builds its transaction from these helpers, so
// the rules that span records are kept in one place:
// - a post, its audience request (`notificationBroadcast`, through
//   notifyCourseStudents) and the checks that the author teaches the course
//   and that it is published are one transaction, so an announcement without
//   its request can't exist;
// - the id is minted by the client and `createdAt` is its time part, so a
//   retried post reproduces the same record, dedupe key and time;
// - an edit only replaces the version it read, and neither an edit nor a
//   delete notifies anyone.

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 20_000;
export const ANNOUNCEMENT_PAGE_MAX = 20;

// How far an id's time may be after and before the server's clock.
const MAX_AHEAD_MS = 60_000;
const MAX_BEHIND_MS = 10 * 60_000;

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The input names something an announcement can't be: callers map it to a
// BAD_REQUEST.
export class AnnouncementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncementInputError';
  }
}

/** The ISO instant in a well-formed UUID v7, or undefined for anything else. */
export const uuidV7Time = (id: string): string | undefined => {
  if (!UUID_V7.test(id)) {
    return undefined;
  }
  const time = new Date(
    Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16),
  );
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
};

/**
 * The instant an announcement id was minted, which is the announcement's
 * `createdAt`. Throws unless the id is a UUID v7 whose time is at most 1
 * minute after and at most 10 minutes before `now`.
 */
export const announcementIdTime = (id: string, now: Date): string => {
  const time = uuidV7Time(id);
  if (time === undefined) {
    throw new AnnouncementInputError('announcementId must be a UUID v7');
  }
  const offset = new Date(time).getTime() - now.getTime();
  if (offset > MAX_AHEAD_MS || offset < -MAX_BEHIND_MS) {
    throw new AnnouncementInputError(
      'announcementId must have been created within the last 10 minutes',
    );
  }
  return time;
};

const validTitle = (title: string) => {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > ANNOUNCEMENT_TITLE_MAX) {
    throw new AnnouncementInputError(
      `title must be 1 to ${ANNOUNCEMENT_TITLE_MAX} characters`,
    );
  }
  return trimmed;
};

const validBody = (body: string) => {
  if (body.length < 1 || body.length > ANNOUNCEMENT_BODY_MAX) {
    throw new AnnouncementInputError(
      `body must be 1 to ${ANNOUNCEMENT_BODY_MAX} characters`,
    );
  }
  return body;
};

export interface AnnouncementCreate {
  courseId: string;
  courseTitle: string;
  announcementId: string;
  title: string;
  body: string;
  /** Plain text, at most 200 characters, from plainTextExcerpt. */
  excerpt: string;
  authorId: string;
  now: Date;
}

/**
 * The items of a post's transaction: the announcement (which must not exist),
 * the author's membership of the course, the course being published, and the
 * request to notify the course's students. A failed condition cancels all.
 */
export const announcementWrites = (
  service: CoreTable,
  input: AnnouncementCreate,
): ReturnType<TransactionWrites> => {
  const { courseId, courseTitle, announcementId, excerpt, authorId } = input;
  const title = validTitle(input.title);
  const body = validBody(input.body);
  const createdAt = announcementIdTime(announcementId, input.now);
  const { announcement, courseInstructor, course } =
    transactionEntities(service);
  return [
    announcement
      .create({
        courseId,
        announcementId,
        title,
        body,
        authorId,
        createdAt,
        version: 1,
      })
      .commit(),
    courseInstructor
      .check({ courseId, instructorId: authorId })
      .where((attr, op) => op.exists(attr.instructorId))
      .commit(),
    course
      .check({ courseId })
      .where((attr, op) => op.eq(attr.status, 'published'))
      .commit(),
    ...notifyCourseStudents(service, {
      type: 'announcement.posted',
      courseId,
      params: { courseId, courseTitle, announcementTitle: title, excerpt },
      dedupeKey: announcementId,
      occurredAt: createdAt,
    }),
  ];
};

export interface AnnouncementEdit {
  courseId: string;
  announcementId: string;
  instructorId: string;
  /** The version the caller read. */
  version: number;
  title?: string;
  body?: string;
  now: Date;
}

/**
 * The items of an edit: a patch of the title and/or body that only replaces
 * the version the caller read, and the instructor's membership check. Never
 * notifies.
 */
export const announcementEditWrites = (
  service: CoreTable,
  input: AnnouncementEdit,
): ReturnType<TransactionWrites> => {
  const { courseId, announcementId, instructorId, version, now } = input;
  if (input.title === undefined && input.body === undefined) {
    throw new AnnouncementInputError('an edit needs a title or a body');
  }
  const changes = {
    ...(input.title !== undefined && { title: validTitle(input.title) }),
    ...(input.body !== undefined && { body: validBody(input.body) }),
  };
  const { announcement, courseInstructor } = transactionEntities(service);
  return [
    announcement
      .patch({ courseId, announcementId })
      .set({ ...changes, editedAt: now.toISOString(), version: version + 1 })
      .where((attr, op) => op.eq(attr.version, version))
      .commit(),
    courseInstructor
      .check({ courseId, instructorId })
      .where((attr, op) => op.exists(attr.instructorId))
      .commit(),
  ];
};

export interface AnnouncementDelete {
  courseId: string;
  announcementId: string;
  instructorId: string;
}

/**
 * The items of a delete: the announcement (which must exist, so a repeat
 * can't recreate anything) and the instructor's membership check. Never
 * notifies; students keep the notification they received.
 */
export const announcementDeleteWrites = (
  service: CoreTable,
  input: AnnouncementDelete,
): ReturnType<TransactionWrites> => {
  const { courseId, announcementId, instructorId } = input;
  const { announcement, courseInstructor } = transactionEntities(service);
  return [
    announcement
      .delete({ courseId, announcementId })
      .where((attr, op) => op.exists(attr.announcementId))
      .commit(),
    courseInstructor
      .check({ courseId, instructorId })
      .where((attr, op) => op.exists(attr.instructorId))
      .commit(),
  ];
};

export interface AnnouncementPageInput {
  courseId: string;
  cursor?: string;
  limit?: number;
}

/**
 * A course's announcements, newest first. `cursor` is the one a previous
 * page returned for the same course; another course's is refused. Paging by
 * key means an announcement posted between two pages is neither repeated nor
 * skips one.
 */
export const announcementPage = async (
  service: CoreTable,
  { courseId, cursor, limit = ANNOUNCEMENT_PAGE_MAX }: AnnouncementPageInput,
) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > ANNOUNCEMENT_PAGE_MAX) {
    throw new AnnouncementInputError(
      `limit must be 1 to ${ANNOUNCEMENT_PAGE_MAX}`,
    );
  }
  const { announcement } = service.entities;
  if (cursor !== undefined && !cursorIsOfCourse(service, courseId, cursor)) {
    throw new AnnouncementInputError('cursor is not for this course');
  }
  const { data, cursor: next } = await announcement.query
    .primary({ courseId })
    .go({ order: 'desc', limit, cursor });
  return { items: data, cursor: next ?? undefined };
};

// ElectroDB's cursor is the last key of the page, as base64url JSON; its
// partition key names the course it was read from.
const cursorIsOfCourse = (
  service: CoreTable,
  courseId: string,
  cursor: string,
) => {
  try {
    const { pk, sk } = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { pk?: unknown; sk?: unknown };
    const { announcement } = service.entities;
    const { ExpressionAttributeValues } = announcement.query
      .primary({ courseId })
      .params() as { ExpressionAttributeValues: Record<string, unknown> };
    return (
      pk === ExpressionAttributeValues[':pk'] &&
      typeof sk === 'string' &&
      sk.startsWith('$announcement_1#announcementid_')
    );
  } catch {
    return false;
  }
};
