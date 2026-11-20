/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { NotFoundError, VersionConflictError } from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationReadProcedure,
  notificationPreferences,
  notificationUnreadCount,
  setNotificationPreferenceProcedure,
} from './notification.js';

const { db, queries, puts, markRead, markAllRead } = vi.hoisted(() => ({
  db: {
    state: undefined as any,
    notifications: [] as any[],
    preferences: [] as any[],
  },
  queries: [] as Record<string, unknown>[],
  puts: [] as Record<string, unknown>[],
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  markNotificationRead: markRead,
  markNotificationsRead: markAllRead,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      notificationState: {
        get: () => ({ go: async () => ({ data: db.state ?? null }) }),
      },
      notification: {
        query: {
          primary: (key: Record<string, unknown>) => ({
            go: async (options: Record<string, unknown>) => {
              queries.push({ ...key, ...options });
              return {
                data: db.notifications.slice(0, options.limit as number),
                cursor:
                  db.notifications.length > (options.limit as number)
                    ? 'next-cursor'
                    : null,
              };
            },
          }),
        },
      },
      notificationPreference: {
        query: {
          primary: () => ({ go: async () => ({ data: db.preferences }) }),
        },
        put: (item: Record<string, unknown>) => ({
          go: async () => {
            puts.push(item);
            return { data: item };
          },
        }),
      },
    },
  })),
}));

const router = t.router({
  list: listNotifications,
  unreadCount: notificationUnreadCount,
  markRead: markNotificationReadProcedure,
  markAllRead: markAllNotificationsRead,
  preferences: notificationPreferences,
  setPreference: setNotificationPreferenceProcedure,
});

const USER_SUB = 'student-1';
const call = (sub: string | null = USER_SUB) =>
  callerFor(router, { sub: sub ?? undefined });

const notification = (n: number, extra: Record<string, unknown> = {}) => ({
  userId: USER_SUB,
  occurredAt: `2026-01-0${n}T00:00:00.000Z`,
  id: `000000000000000${n}`,
  type: 'assignment.returned',
  title: `Title ${n}`,
  body: `Body ${n}`,
  link: { portal: 'student', path: '/learn/c/lesson/l' },
  email: { state: 'sent', messageId: 'secret-id' },
  ...extra,
});
const position = (n: number) =>
  `2026-01-0${n}T00:00:00.000Z#000000000000000${n}`;

beforeEach(() => {
  db.state = undefined;
  db.notifications = [];
  db.preferences = [];
  queries.length = 0;
  puts.length = 0;
  markRead.mockReset();
  markAllRead.mockReset();
});

describe('notification.list', () => {
  it('does not return an email action', async () => {
    db.notifications = [
      notification(1, { action: { label: 'Go', path: '/x' } }),
    ];
    const result = await call().list({});
    expect(result.items[0]).not.toHaveProperty('action');
  });

  it('lists newest first with read derived and the unread count', async () => {
    db.state = { unreadCount: 1, readThrough: position(2), version: 3 };
    db.notifications = [
      notification(3),
      notification(2),
      notification(1, { readAt: '2026-01-05T00:00:00.000Z' }),
    ];
    const result = await call().list({});
    expect(queries[0]).toMatchObject({ userId: USER_SUB, order: 'desc' });
    expect(result.unreadCount).toBe(1);
    expect(result.items.map((i) => [i.position, i.read])).toEqual([
      [position(3), false],
      [position(2), true],
      [position(1), true],
    ]);
  });

  it('never carries readAt or email state', async () => {
    db.notifications = [
      notification(1, { readAt: '2026-01-05T00:00:00.000Z' }),
    ];
    const result = await call().list({});
    expect(Object.keys(result.items[0]!).sort()).toEqual([
      'body',
      'link',
      'occurredAt',
      'position',
      'read',
      'title',
      'type',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-id');
  });

  it('defaults the limit to 20, bounds it to 1..50, and returns the cursor', async () => {
    db.notifications = [notification(1), notification(2), notification(3)];
    await call().list({});
    expect(queries[0]!.limit).toBe(20);
    await expect(call().list({ limit: 0 })).rejects.toThrow();
    await expect(call().list({ limit: 51 })).rejects.toThrow();
    const page = await call().list({ limit: 2 });
    expect(page.nextCursor).toBe('next-cursor');
    expect(page.items).toHaveLength(2);
    await call().list({ limit: 2, cursor: 'next-cursor' });
    expect(queries.at(-1)!.cursor).toBe('next-cursor');
    expect((await call().list({ limit: 3 })).nextCursor).toBeUndefined();
  });

  it('reports 0 unread for a user with no state', async () => {
    expect((await call().list({})).unreadCount).toBe(0);
  });
});

describe('notification.unreadCount', () => {
  it('is 0 with no state', async () => {
    expect(await call().unreadCount()).toEqual({ unreadCount: 0 });
  });

  it('is the state record count', async () => {
    db.state = { unreadCount: 4, version: 2 };
    expect(await call().unreadCount()).toEqual({ unreadCount: 4 });
  });
});

describe('notification.markRead', () => {
  it('marks the caller own position and returns the count', async () => {
    markRead.mockResolvedValue({ unreadCount: 2 });
    expect(await call().markRead({ position: position(1) })).toEqual({
      unreadCount: 2,
    });
    expect(markRead).toHaveBeenCalledWith(
      expect.anything(),
      USER_SUB,
      position(1),
    );
  });

  it('is NOT_FOUND, with one message, for a missing or another user position', async () => {
    markRead.mockRejectedValue(new NotFoundError('Notification not found'));
    const error = await call()
      .markRead({ position: position(1) })
      .catch((e) => e);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Notification not found');
  });

  it('is CONFLICT when the state keeps changing', async () => {
    markRead.mockRejectedValue(new VersionConflictError());
    await expect(
      call().markRead({ position: position(1) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('notification.markAllRead', () => {
  it('returns the count and whether more remain', async () => {
    markAllRead.mockResolvedValue({ unreadCount: 7, more: true });
    expect(await call().markAllRead({ through: position(3) })).toEqual({
      unreadCount: 7,
      more: true,
    });
    expect(markAllRead).toHaveBeenCalledWith(
      expect.anything(),
      USER_SUB,
      position(3),
    );
  });

  it('is NOT_FOUND when through is not the caller own position', async () => {
    markAllRead.mockRejectedValue(new NotFoundError('Notification not found'));
    await expect(
      call().markAllRead({ through: position(3) }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Notification not found',
    });
  });

  it('is CONFLICT after the retries', async () => {
    markAllRead.mockRejectedValue(new VersionConflictError());
    await expect(
      call().markAllRead({ through: position(3) }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('notification.preferences', () => {
  it('lists the registry in order, without never types, with defaults', async () => {
    const result = await call().preferences();
    expect(result.map((p) => p.type)).toEqual([
      'assignment.returned',
      'announcement.posted',
      'certificate.issued',
      'discussion.reply',
      'discussion.answered',
      'discussion.accepted',
      'order.refunded',
      'review.received',
    ]);
    expect(result.map((p) => p.emailEnabled)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      true,
      false,
    ]);
    expect(result.find((p) => p.type === 'certificate.issued')).toMatchObject({
      name: 'Certificates',
      emailEnabled: true,
    });
    // Only the refund notice is required: it is always emailed.
    expect(result.filter((p) => p.required).map((p) => p.type)).toEqual([
      'order.refunded',
    ]);
    expect(Object.keys(result[0]!).sort()).toEqual([
      'description',
      'emailEnabled',
      'name',
      'required',
      'type',
    ]);
  });

  it('has one Certificates row and none for the reminder', async () => {
    const result = await call().preferences();
    expect(result.filter((p) => p.name === 'Certificates')).toHaveLength(1);
    expect(
      result.find((p) => p.type === 'certificate.reminder'),
    ).toBeUndefined();
  });

  it('applies stored overrides', async () => {
    db.preferences = [
      { type: 'assignment.returned', emailEnabled: false },
      { type: 'review.received', emailEnabled: true },
    ];
    const result = await call().preferences();
    expect(result.map((p) => p.emailEnabled)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
      true,
      true,
    ]);
  });
});

describe('notification.setPreference', () => {
  it('stores the choice for the caller only', async () => {
    const result = await call().setPreference({
      type: 'discussion.reply',
      emailEnabled: false,
    });
    expect(puts).toEqual([
      { userId: USER_SUB, type: 'discussion.reply', emailEnabled: false },
    ]);
    expect(result).toMatchObject({
      type: 'discussion.reply',
      emailEnabled: false,
      required: false,
    });
  });

  it('allows writing the registry default', async () => {
    await call().setPreference({
      type: 'review.received',
      emailEnabled: false,
    });
    expect(puts).toHaveLength(1);
  });

  it('is NOT_FOUND for an unknown type', async () => {
    for (const type of ['nope.nope', 'constructor', '__proto__']) {
      await expect(
        call().setPreference({ type, emailEnabled: true }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(puts).toHaveLength(0);
  });

  it('is BAD_REQUEST for a type that follows another type’s setting', async () => {
    await expect(
      call().setPreference({
        type: 'certificate.reminder',
        emailEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(puts).toHaveLength(0);
  });

  it('is BAD_REQUEST for required and never types', async () => {
    const { NOTIFICATION_TYPES } = await import('@discava/core-table');
    const original = { ...NOTIFICATION_TYPES };
    try {
      NOTIFICATION_TYPES['test.required'] = {
        ...original['assignment.returned']!,
        id: 'test.required',
        emailPolicy: 'required',
      };
      NOTIFICATION_TYPES['test.never'] = {
        ...original['assignment.returned']!,
        id: 'test.never',
        emailPolicy: 'never',
      };
      for (const type of ['test.required', 'test.never']) {
        await expect(
          call().setPreference({ type, emailEnabled: false }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      const listed = await call().preferences();
      expect(listed.find((p) => p.type === 'test.required')).toMatchObject({
        emailEnabled: true,
        required: true,
      });
      expect(listed.find((p) => p.type === 'test.never')).toBeUndefined();
      expect(puts).toHaveLength(0);
    } finally {
      delete NOTIFICATION_TYPES['test.required'];
      delete NOTIFICATION_TYPES['test.never'];
    }
  });
});

describe('unauthenticated callers', () => {
  it.each([
    ['list', (c: any) => c.list({})],
    ['unreadCount', (c: any) => c.unreadCount()],
    ['markRead', (c: any) => c.markRead({ position: position(1) })],
    ['markAllRead', (c: any) => c.markAllRead({ through: position(1) })],
    ['preferences', (c: any) => c.preferences()],
    [
      'setPreference',
      (c: any) =>
        c.setPreference({ type: 'discussion.reply', emailEnabled: true }),
    ],
  ])('%s is UNAUTHORIZED', async (_name, run) => {
    await expect(run(call(null))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
