/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NotFoundError, VersionConflictError } from './errors.js';
import { notificationPosition, publishNotification } from './notification.js';
import { createFakeNotificationTable } from './notification-fake.test.js';
import {
  MARK_ALL_CHUNK,
  markNotificationRead,
  markNotificationsRead,
} from './notification-read.js';

const params = {
  courseId: 'c1',
  lessonId: 'l1',
  assignmentTitle: 'Essay',
  courseTitle: 'History',
};

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 16, 0, 0, 0) + n * 1000).toISOString();

// Publishes n notifications for a user, one second apart, and returns their
// positions oldest first.
const seed = async (
  fake: ReturnType<typeof createFakeNotificationTable>,
  n: number,
  userId = 'u1',
  from = 0,
) => {
  const positions: string[] = [];
  for (let i = from; i < from + n; i++) {
    await publishNotification(fake.service, {
      type: 'assignment.returned',
      userId,
      params,
      dedupeKey: `k${i}`,
      occurredAt: at(i),
    });
  }
  for (const row of [...fake.rows.notification!.values()]
    .filter((r) => r.userId === userId)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))) {
    positions.push(notificationPosition(row.occurredAt, row.id));
  }
  return positions;
};

const state = (
  fake: ReturnType<typeof createFakeNotificationTable>,
  u = 'u1',
) => fake.rows.notificationState!.get(u)!;

describe('markNotificationRead', () => {
  it('sets readAt and lowers the count and moves the version', async () => {
    const fake = createFakeNotificationTable();
    const [first] = await seed(fake, 3);
    const before = state(fake).version;

    const result = await markNotificationRead(fake.service, 'u1', first!);

    expect(result).toEqual({ unreadCount: 2 });
    expect(state(fake)).toMatchObject({ unreadCount: 2, version: before + 1 });
    const stored = [...fake.rows.notification!.values()].filter(
      (n) => n.readAt,
    );
    expect(stored).toHaveLength(1);
  });

  it('is a no-op success when already read, with no write', async () => {
    const fake = createFakeNotificationTable();
    const [first] = await seed(fake, 2);
    await markNotificationRead(fake.service, 'u1', first!);
    const transactions = fake.log.transactions;
    const version = state(fake).version;

    expect(await markNotificationRead(fake.service, 'u1', first!)).toEqual({
      unreadCount: 1,
    });
    expect(fake.log.transactions).toBe(transactions);
    expect(state(fake).version).toBe(version);
  });

  it('is a no-op for a position at or before readThrough', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 3);
    await markNotificationsRead(fake.service, 'u1', positions[1]!);
    const transactions = fake.log.transactions;

    expect(
      await markNotificationRead(fake.service, 'u1', positions[0]!),
    ).toEqual({
      unreadCount: 1,
    });
    expect(fake.log.transactions).toBe(transactions);
  });

  it('throws not found for another user’s, a missing and a malformed position', async () => {
    const fake = createFakeNotificationTable();
    const [mine] = await seed(fake, 1, 'u1');
    await seed(fake, 1, 'u2', 10);
    const missing = notificationPosition(at(99), 'a'.repeat(16));

    await expect(
      markNotificationRead(fake.service, 'u2', mine!),
    ).rejects.toThrow(NotFoundError);
    await expect(
      markNotificationRead(fake.service, 'u1', missing),
    ).rejects.toThrow(NotFoundError);
    await expect(
      markNotificationRead(fake.service, 'u1', 'nonsense'),
    ).rejects.toThrow(NotFoundError);
    expect(state(fake)).toMatchObject({ unreadCount: 1 });
  });

  it('retries a version conflict and ends consistent', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 2);
    let publishes = 1;
    fake.hooks.beforeTransaction = () => {
      // A publish lands first: the count and version move under the mark.
      if (publishes-- > 0) {
        const s = state(fake);
        s.unreadCount++;
        s.version++;
      }
    };
    const result = await markNotificationRead(
      fake.service,
      'u1',
      positions[0]!,
    );
    expect(result).toEqual({ unreadCount: 2 });
    expect(state(fake).unreadCount).toBe(2);
  });

  it('throws a conflict after 3 version conflicts', async () => {
    const fake = createFakeNotificationTable();
    const [first] = await seed(fake, 2);
    fake.hooks.beforeTransaction = () => {
      state(fake).version++;
    };
    await expect(
      markNotificationRead(fake.service, 'u1', first!),
    ).rejects.toThrow(VersionConflictError);
  });
});

describe('markNotificationsRead', () => {
  it('marks everything up to the position and leaves a newer one unread', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 4);

    const result = await markNotificationsRead(
      fake.service,
      'u1',
      positions[2]!,
    );

    expect(result).toEqual({ unreadCount: 1, more: false });
    expect(state(fake)).toMatchObject({
      unreadCount: 1,
      readThrough: positions[2],
    });
  });

  it('does not double-decrement what was marked one by one', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 4);
    await markNotificationRead(fake.service, 'u1', positions[0]!);
    await markNotificationRead(fake.service, 'u1', positions[2]!);
    expect(state(fake).unreadCount).toBe(2);

    const result = await markNotificationsRead(
      fake.service,
      'u1',
      positions[3]!,
    );

    expect(result).toEqual({ unreadCount: 0, more: false });
  });

  it('does not move readThrough backwards, and a repeat is a no-op', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 3);
    await markNotificationsRead(fake.service, 'u1', positions[2]!);
    const transactions = fake.log.transactions;

    expect(
      await markNotificationsRead(fake.service, 'u1', positions[0]!),
    ).toEqual({
      unreadCount: 0,
      more: false,
    });
    expect(fake.log.transactions).toBe(transactions);
    expect(state(fake).readThrough).toBe(positions[2]);
  });

  it('continues from readThrough on a second call', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 4);
    await markNotificationsRead(fake.service, 'u1', positions[1]!);
    const result = await markNotificationsRead(
      fake.service,
      'u1',
      positions[3]!,
    );
    expect(result).toEqual({ unreadCount: 0, more: false });
    expect(state(fake).readThrough).toBe(positions[3]);
  });

  it('moves at most 500 at a time and says there is more', async () => {
    const fake = createFakeNotificationTable();
    const total = MARK_ALL_CHUNK + 20;
    const positions = await seed(fake, total);

    const first = await markNotificationsRead(
      fake.service,
      'u1',
      positions[total - 1]!,
    );
    expect(first).toEqual({ unreadCount: 20, more: true });
    expect(state(fake).readThrough).toBe(positions[MARK_ALL_CHUNK - 1]);

    const second = await markNotificationsRead(
      fake.service,
      'u1',
      positions[total - 1]!,
    );
    expect(second).toEqual({ unreadCount: 0, more: false });
  });

  it('keeps every count when more than 500 remain after a readThrough', async () => {
    const fake = createFakeNotificationTable();
    const total = 2 * MARK_ALL_CHUNK + 100;
    const positions = await seed(fake, total);
    const last = positions[total - 1]!;

    const first = await markNotificationsRead(fake.service, 'u1', last);
    expect(first).toEqual({ unreadCount: total - MARK_ALL_CHUNK, more: true });
    // 600 remain after readThrough: the boundary notification the range
    // query returns again must not use up a slot of the next chunk.
    const second = await markNotificationsRead(fake.service, 'u1', last);
    expect(second).toEqual({ unreadCount: 100, more: true });
    expect(state(fake).readThrough).toBe(positions[2 * MARK_ALL_CHUNK - 1]);

    const third = await markNotificationsRead(fake.service, 'u1', last);
    expect(third).toEqual({ unreadCount: 0, more: false });
    expect(state(fake)).toMatchObject({ unreadCount: 0, readThrough: last });
  });

  it('retries when a publish lands mid-way, and ends consistent', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 3);
    let once = true;
    fake.hooks.beforeTransaction = () => {
      if (once) {
        once = false;
        const s = state(fake);
        s.unreadCount++;
        s.version++;
      }
    };
    const result = await markNotificationsRead(
      fake.service,
      'u1',
      positions[2]!,
    );
    // The racing publish's own count (1) stays; the three are read.
    expect(result.unreadCount).toBe(1);
    expect(state(fake).unreadCount).toBe(1);
  });

  it('throws a conflict after 3 version conflicts', async () => {
    const fake = createFakeNotificationTable();
    const positions = await seed(fake, 2);
    fake.hooks.beforeTransaction = () => {
      state(fake).version++;
    };
    await expect(
      markNotificationsRead(fake.service, 'u1', positions[1]!),
    ).rejects.toThrow(VersionConflictError);
  });

  it('throws not found for another user’s, a missing and a malformed position', async () => {
    const fake = createFakeNotificationTable();
    const [mine] = await seed(fake, 1, 'u1');
    await seed(fake, 1, 'u2', 10);
    await expect(
      markNotificationsRead(fake.service, 'u2', mine!),
    ).rejects.toThrow(NotFoundError);
    await expect(
      markNotificationsRead(
        fake.service,
        'u1',
        notificationPosition(at(99), 'b'.repeat(16)),
      ),
    ).rejects.toThrow(NotFoundError);
    await expect(
      markNotificationsRead(fake.service, 'u1', 'x'),
    ).rejects.toThrow(NotFoundError);
  });
});
