/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import { NotFoundError, VersionConflictError } from './errors.js';
import {
  notificationPosition,
  parseNotificationPosition,
  transactionEntities,
} from './notification.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The read side of the notification helpers: marking one notification, or
// every notification up to a position, as read. Both change the user's
// notificationState, conditioned on the `version` they read, so a publish or
// another mark landing in between cancels the write and it is read again.
// Only core-api's markRead and markAllRead call these; producers must not.

const MAX_RETRIES = 3;
/** The most notifications one markNotificationsRead call moves past. */
export const MARK_ALL_CHUNK = 500;

const notFound = () => new NotFoundError('Notification not found');

// The caller's own notification at a position, or not found. The error is the
// same for a malformed position, a missing one and another user's.
const ownNotification = async (
  service: CoreTable,
  userId: string,
  position: string,
) => {
  const key = parseNotificationPosition(position);
  if (!key) {
    throw notFound();
  }
  const { data } = await service.entities.notification
    .get({ userId, ...key })
    .go();
  if (!data) {
    throw notFound();
  }
  return data;
};

const isRead = (
  notification: { readAt?: string },
  position: string,
  readThrough?: string,
) =>
  notification.readAt !== undefined ||
  (readThrough !== undefined && position <= readThrough);

/**
 * Marks one notification read and returns the user's unread count. Already
 * read is a success with no write.
 */
export const markNotificationRead = async (
  service: CoreTable,
  userId: string,
  position: string,
  now = new Date(),
): Promise<{ unreadCount: number }> => {
  const reads = service.entities;
  const writes = transactionEntities(service);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const found = await ownNotification(service, userId, position);
    const { data: state } = await reads.notificationState.get({ userId }).go();
    if (!state) {
      throw new Error(`User ${userId} has notifications but no state`);
    }
    if (isRead(found, position, state.readThrough)) {
      return { unreadCount: state.unreadCount };
    }
    const { canceled } = await service.transaction
      .write(() => [
        writes.notification
          .patch({ userId, occurredAt: found.occurredAt, id: found.id })
          .set({ readAt: now.toISOString() })
          .where((attr, op) => op.notExists(attr.readAt))
          .commit(),
        writes.notificationState
          .patch({ userId })
          .add({ version: 1 })
          .subtract({ unreadCount: 1 })
          .where((attr, op) => op.eq(attr.version, state.version))
          .commit(),
      ])
      .go();
    if (!canceled) {
      return { unreadCount: state.unreadCount - 1 };
    }
  }
  throw new VersionConflictError();
};

/**
 * Marks every notification after the user's `readThrough`, up to and
 * including the one at `through`, as read; at most MARK_ALL_CHUNK of them per
 * call. `more` is true when `through` wasn't reached, so the caller calls
 * again.
 */
export const markNotificationsRead = async (
  service: CoreTable,
  userId: string,
  through: string,
): Promise<{ unreadCount: number; more: boolean }> => {
  const reads = service.entities;
  const writes = transactionEntities(service);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await ownNotification(service, userId, through);
    const { data: state } = await reads.notificationState.get({ userId }).go();
    if (!state) {
      throw new Error(`User ${userId} has notifications but no state`);
    }
    const { readThrough } = state;
    if (readThrough !== undefined && through <= readThrough) {
      return { unreadCount: state.unreadCount, more: false };
    }

    const upTo = parseNotificationPosition(through);
    const from = readThrough && parseNotificationPosition(readThrough);
    const query = reads.notification.query.primary({ userId });
    // One more than the chunk, to know whether there is more; and one for
    // the readThrough notification itself, which `between` includes and the
    // filter below drops.
    const { data } = await (from
      ? query.between(from, upTo!)
      : query.lte(upTo!)
    ).go({
      limit: MARK_ALL_CHUNK + (from ? 2 : 1),
      pages: 1,
    });
    const range = data
      .map((n) => ({
        ...n,
        position: notificationPosition(n.occurredAt, n.id),
      }))
      .filter((n) => readThrough === undefined || n.position > readThrough)
      .sort((a, b) => (a.position < b.position ? -1 : 1));
    const chunk = range.slice(0, MARK_ALL_CHUNK);
    const more = range.length > MARK_ALL_CHUNK;
    const newThrough = more ? chunk[chunk.length - 1]!.position : through;
    const unread = chunk.filter((n) => n.readAt === undefined).length;

    const moved = writes.notificationState
      .patch({ userId })
      .set({ readThrough: newThrough })
      .add({ version: 1 });
    const { canceled } = await service.transaction
      .write(() => [
        (unread > 0 ? moved.subtract({ unreadCount: unread }) : moved)
          .where(
            (attr, op) =>
              `${op.eq(attr.version, state.version)} AND ${
                readThrough === undefined
                  ? op.notExists(attr.readThrough)
                  : op.eq(attr.readThrough, readThrough)
              }`,
          )
          .commit(),
      ])
      .go();
    if (!canceled) {
      return { unreadCount: state.unreadCount - unread, more };
    }
  }
  throw new VersionConflictError();
};
