/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { createCoreTableService } from '../service.js';
import {
  cancellationReasons,
  failedAt,
  hasFailedCondition,
  hasTransactionConflict,
  VersionConflictError,
} from './errors.js';
import {
  buildNotification,
  NotificationInputError,
} from './notification-types.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];
export type NotificationTransactionItems = ReturnType<TransactionWrites>;

// The service's entities with `commit`, which ElectroDB's types offer only
// inside a transaction callback but which every entity operation has at
// runtime. The helpers build their items outside the callback so a producer
// can add them to a transaction of its own.
export const transactionEntities = (service: CoreTable) =>
  service.entities as unknown as TransactionEntities;

// The only writer of `notification`, `notificationState` (with
// helpers/notification-read.ts) and `notificationBroadcast` (#406). Every
// producer builds its notifications here, so the rules other code relies on
// are kept in one place:
// - a notification's id comes from its type and the producer's dedupe key, so
//   publishing the same event twice is one notification;
// - the first notification for a user creates their notificationState, and
//   every later one moves its unreadCount in the same transaction,
//   conditioned on the state's `version`;
// - a notification at or before the user's `readThrough` is created read and
//   isn't counted.

const MAX_STATE_RETRIES = 3;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface NotificationInput {
  type: string;
  userId: string;
  params: Record<string, string>;
  /** Names the event, e.g. `${contentItemId}:${version}`. */
  dedupeKey: string;
  /** ISO instant from the producer's own record (UTC, milliseconds). */
  occurredAt: string;
}

export interface NotifyCourseStudentsInput {
  type: string;
  courseId: string;
  params: Record<string, string>;
  dedupeKey: string;
  occurredAt: string;
}

const sha16 = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);

/** A notification's id: the first 16 hex characters of sha256(type, key). */
export const notificationId = (type: string, dedupeKey: string) =>
  sha16(type, dedupeKey);

/** A broadcast's id: sha256(type, courseId, key), first 16 hex characters. */
export const notificationBroadcastId = (
  type: string,
  courseId: string,
  dedupeKey: string,
) => sha16(type, courseId, dedupeKey);

/** A notification's position: its sort key, and its public id. */
export const notificationPosition = (occurredAt: string, id: string) =>
  `${occurredAt}#${id}`;

/** The key attributes a position stands for, or undefined if malformed. */
export const parseNotificationPosition = (position: string) => {
  const at = position.indexOf('#');
  const occurredAt = position.slice(0, at);
  const id = position.slice(at + 1);
  return at > 0 && ISO_INSTANT.test(occurredAt) && /^[0-9a-f]{16}$/.test(id)
    ? { occurredAt, id }
    : undefined;
};

const validate = (input: {
  type: string;
  params: Record<string, string>;
  dedupeKey: string;
  occurredAt: string;
}) => {
  const built = buildNotification(input.type, input.params);
  if (typeof input.dedupeKey !== 'string' || input.dedupeKey === '') {
    throw new NotificationInputError('dedupeKey must be a non-empty string');
  }
  if (
    typeof input.occurredAt !== 'string' ||
    !ISO_INSTANT.test(input.occurredAt) ||
    Number.isNaN(Date.parse(input.occurredAt))
  ) {
    throw new NotificationInputError(
      'occurredAt must be an ISO instant such as 2026-01-02T03:04:05.678Z',
    );
  }
  return built;
};

/**
 * The transaction items that publish one notification: its create, and the
 * user's state create or update. Add them to the producer's own
 * `service.transaction.write`. A duplicate publish, or a state changed since
 * it was read, cancels the transaction; the caller reads again and retries.
 */
export const notificationWrites = async (
  service: CoreTable,
  input: NotificationInput,
): Promise<NotificationTransactionItems> => {
  const built = validate(input);
  const { userId, type, occurredAt } = input;
  const id = notificationId(type, input.dedupeKey);
  const { notification, notificationState } = transactionEntities(service);

  const { data: state } = await service.entities.notificationState
    .get({ userId })
    .go();
  const alreadyRead =
    state?.readThrough !== undefined &&
    notificationPosition(occurredAt, id) <= state.readThrough;

  const created = notification
    .create({
      userId,
      occurredAt,
      id,
      type,
      ...built,
      ...(alreadyRead ? { readAt: occurredAt } : {}),
    })
    .commit();

  if (!state) {
    return [
      created,
      notificationState.create({ userId, unreadCount: 1, version: 1 }).commit(),
    ];
  }
  const update = notificationState
    .patch({ userId })
    .add({ version: 1, ...(alreadyRead ? {} : { unreadCount: 1 }) })
    .where((attr, op) => op.eq(attr.version, state.version))
    .commit();
  return [created, update];
};

/**
 * Publishes one notification in its own transaction. 'duplicate' when the
 * same type, user and dedupeKey was published before. Retries a state
 * version conflict up to 3 times, then throws.
 */
export const publishNotification = async (
  service: CoreTable,
  input: NotificationInput,
): Promise<'created' | 'duplicate'> => {
  for (let attempt = 0; attempt <= MAX_STATE_RETRIES; attempt++) {
    const items = await notificationWrites(service, input);
    const { canceled, data } = await service.transaction
      .write(() => items)
      .go();
    if (!canceled) {
      return 'created';
    }
    const reasons = cancellationReasons(data);
    // Item 0 is the notification's create: its condition failing means it
    // already exists.
    if (failedAt(reasons, 0)) {
      await warnIfDifferent(service, input);
      return 'duplicate';
    }
    const retryable =
      hasFailedCondition(reasons) || hasTransactionConflict(reasons);
    if (!retryable) {
      throw new Error('The notification transaction was cancelled');
    }
  }
  throw new VersionConflictError();
};

// A repeated key whose stored title differs from what these params build
// means a producer reused a key for another event.
const warnIfDifferent = async (
  service: CoreTable,
  input: NotificationInput,
) => {
  try {
    const id = notificationId(input.type, input.dedupeKey);
    const { data } = await service.entities.notification
      .get({ userId: input.userId, occurredAt: input.occurredAt, id })
      .go();
    const { title } = buildNotification(input.type, input.params);
    if (data && data.title !== title) {
      console.warn(
        `Notification ${input.type} ${id} was published again with other params`,
      );
    }
  } catch {
    // Only a warning; never fail the publish for it.
  }
};

/**
 * One `notificationBroadcast` create asking the pipeline to notify every
 * student enrolled in the course. A repeat with the same key cancels on it.
 */
export const notifyCourseStudents = (
  service: CoreTable,
  input: NotifyCourseStudentsInput,
): NotificationTransactionItems => {
  validate(input);
  if (typeof input.courseId !== 'string' || input.courseId === '') {
    throw new NotificationInputError('courseId must be a non-empty string');
  }
  const { type, courseId, dedupeKey, occurredAt } = input;
  return [
    transactionEntities(service)
      .notificationBroadcast.create({
        id: notificationBroadcastId(type, courseId, dedupeKey),
        type,
        courseId,
        params: input.params,
        occurredAt,
        dedupeKey,
        status: 'pending',
      })
      .commit(),
  ];
};
