/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CoreTable,
  InvalidRequestError,
  markNotificationRead,
  markNotificationsRead,
  NOTIFICATION_TYPES,
  NotFoundError,
  notificationPosition,
  setNotificationPreference,
  VersionConflictError,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  type INotificationPreference,
  NotificationListInputSchema,
  NotificationListOutputSchema,
  NotificationMarkAllReadInputSchema,
  NotificationMarkAllReadOutputSchema,
  NotificationMarkReadInputSchema,
  NotificationPreferenceSchema,
  NotificationPreferencesOutputSchema,
  NotificationSetPreferenceInputSchema,
  NotificationUnreadCountOutputSchema,
} from '../schema/index.js';

// The helpers throw their own errors for the cases a caller can cause; this
// maps them to the API's codes. The not-found message is the same for a
// missing notification and another user's.
const asTrpcError = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    }
    if (error instanceof InvalidRequestError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    if (error instanceof VersionConflictError) {
      throw new TRPCError({ code: 'CONFLICT', message: error.message });
    }
    throw error;
  }
};

const unreadCountOf = async (coreTable: CoreTable, userId: string) => {
  const { data } = await coreTable.entities.notificationState
    .get({ userId })
    .go();
  return {
    unreadCount: data?.unreadCount ?? 0,
    readThrough: data?.readThrough,
  };
};

// The types a user can set: every registered type that is emailed at all, in
// registry order.
const settableTypes = () =>
  Object.values(NOTIFICATION_TYPES).filter(
    (type) => type.emailPolicy !== 'never',
  );

const preferenceFor = (
  type: (typeof NOTIFICATION_TYPES)[string],
  stored: Map<string, boolean>,
): INotificationPreference => ({
  type: type.id,
  name: type.name,
  description: type.description,
  // A required type is always emailed; the others default as the registry
  // says unless the user changed them.
  emailEnabled:
    type.emailPolicy === 'required'
      ? true
      : (stored.get(type.id) ?? type.emailPolicy === 'default-on'),
  required: type.emailPolicy === 'required',
});

/** The caller's notifications, newest first, with their unread count. */
export const listNotifications = courseProcedure
  .input(NotificationListInputSchema)
  .output(NotificationListOutputSchema)
  .query(async ({ ctx, input }) => {
    const coreTable = ctx.coreTable;
    const userId = ctx.user.sub;
    const [{ data, cursor }, { unreadCount, readThrough }] = await Promise.all([
      coreTable.entities.notification.query.primary({ userId }).go({
        order: 'desc',
        limit: input.limit,
        pages: 1,
        ...(input.cursor && { cursor: input.cursor }),
      }),
      unreadCountOf(coreTable, userId),
    ]);
    return {
      items: data.map((n) => {
        const position = notificationPosition(n.occurredAt, n.id);
        return {
          position,
          type: n.type,
          title: n.title,
          body: n.body,
          link: { portal: n.link.portal, path: n.link.path },
          occurredAt: n.occurredAt,
          read:
            n.readAt !== undefined ||
            (readThrough !== undefined && position <= readThrough),
        };
      }),
      ...(cursor && { nextCursor: cursor }),
      unreadCount,
    };
  });

/** The caller's unread count: one keyed get; 0 for a user with no state. */
export const notificationUnreadCount = courseProcedure
  .output(NotificationUnreadCountOutputSchema)
  .query(async ({ ctx }) => {
    const { unreadCount } = await unreadCountOf(ctx.coreTable, ctx.user.sub);
    return { unreadCount };
  });

export const markNotificationReadProcedure = courseProcedure
  .input(NotificationMarkReadInputSchema)
  .output(NotificationUnreadCountOutputSchema)
  .mutation(({ ctx, input }) =>
    asTrpcError(() =>
      markNotificationRead(ctx.coreTable, ctx.user.sub, input.position),
    ),
  );

export const markAllNotificationsRead = courseProcedure
  .input(NotificationMarkAllReadInputSchema)
  .output(NotificationMarkAllReadOutputSchema)
  .mutation(({ ctx, input }) =>
    asTrpcError(() =>
      markNotificationsRead(ctx.coreTable, ctx.user.sub, input.through),
    ),
  );

/** One entry per type the caller can choose an email setting for. */
export const notificationPreferences = courseProcedure
  .output(NotificationPreferencesOutputSchema)
  .query(async ({ ctx }) => {
    const { data } = await ctx.coreTable.entities.notificationPreference.query
      .primary({
        userId: ctx.user.sub,
      })
      .go({ pages: 'all' });
    const stored = new Map(data.map((p) => [p.type, p.emailEnabled]));
    return settableTypes().map((type) => preferenceFor(type, stored));
  });

export const setNotificationPreferenceProcedure = courseProcedure
  .input(NotificationSetPreferenceInputSchema)
  .output(NotificationPreferenceSchema)
  .mutation(async ({ ctx, input }) => {
    const type = await asTrpcError(() =>
      setNotificationPreference(
        ctx.coreTable,
        ctx.user.sub,
        input.type,
        input.emailEnabled,
      ),
    );
    return preferenceFor(type, new Map([[type.id, input.emailEnabled]]));
  });
