/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: a test helper, like the *.test.ts files
import { vi } from 'vitest';

// An in-memory stand-in for the core table's notification pieces, shared by
// the send-email and delivery tests. Its transitions have the conditions of
// core-table's helpers/notification-email.ts (each moves only from the
// state it names), which core-table tests against the real entity.

export interface FakeNotification {
  userId: string;
  occurredAt: string;
  id: string;
  type: string;
  title: string;
  body: string;
  link: { portal: 'student' | 'instructor' | 'admin'; path: string };
  email: {
    state: string;
    reason?: string;
    claimedAt?: string;
    sentAt?: string;
    messageId?: string;
  };
}

export const notificationKey = (
  n: Pick<FakeNotification, 'userId' | 'occurredAt' | 'id'>,
) => `${n.userId}|${n.occurredAt}|${n.id}`;

export const fakeNotification = (
  overrides: Partial<FakeNotification> = {},
): FakeNotification => ({
  userId: 'u1',
  occurredAt: '2026-11-17T00:00:00.000Z',
  id: 'abcdef0123456789',
  type: 'announcement.posted',
  title: 'Course: Hello',
  body: 'Body',
  link: { portal: 'student', path: '/learn/c1/home' },
  email: { state: 'pending' },
  ...overrides,
});

export const createFakeTable = () => {
  const notifications = new Map<string, FakeNotification>();
  const users = new Map<string, { email?: string }>();
  const preferences = new Map<string, { emailEnabled: boolean }>();

  const move = (
    key: { userId: string; occurredAt: string; id: string },
    from: string,
    email: FakeNotification['email'],
  ) => {
    const found = notifications.get(notificationKey(key));
    if (!found || found.email.state !== from) {
      return Promise.resolve(false);
    }
    found.email = email;
    return Promise.resolve(true);
  };

  const transitions = {
    skipEmail: vi.fn((_t, key, reason: string) =>
      move(key, 'pending', { state: 'skipped', reason }),
    ),
    claimEmail: vi.fn((_t, key, claimedAt: string) =>
      move(key, 'pending', { state: 'sending', claimedAt }),
    ),
    markEmailSent: vi.fn((_t, key, messageId: string, sentAt: string) =>
      move(key, 'sending', { state: 'sent', sentAt, messageId }),
    ),
    markEmailFailed: vi.fn((_t, key, reason: string) =>
      move(key, 'sending', { state: 'failed', reason }),
    ),
    releaseEmailClaim: vi.fn((_t, key) =>
      move(key, 'sending', { state: 'pending' }),
    ),
    markEmailUnknown: vi.fn((_t, key) =>
      move(key, 'sending', { state: 'unknown' }),
    ),
    readEmailState: vi.fn(
      async (_t, key) => notifications.get(notificationKey(key))?.email,
    ),
  };

  const table = {
    entities: {
      notification: {
        get: (key: { userId: string; occurredAt: string; id: string }) => ({
          go: async () => ({ data: notifications.get(notificationKey(key)) }),
        }),
      },
      user: {
        get: ({ userId }: { userId: string }) => ({
          go: async () => ({ data: users.get(userId) }),
        }),
      },
      notificationPreference: {
        get: ({ userId, type }: { userId: string; type: string }) => ({
          go: async () => ({ data: preferences.get(`${userId}|${type}`) }),
        }),
      },
    },
  };

  return {
    table: table as never,
    notifications,
    users,
    preferences,
    transitions,
    add: (notification: FakeNotification) => {
      notifications.set(notificationKey(notification), notification);
      return notification;
    },
  };
};
