/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createNotificationBroadcastEntity } from './notification-broadcast.js';

let broadcast: Awaited<ReturnType<typeof createNotificationBroadcastEntity>>;
beforeAll(async () => {
  process.env.LOCAL_DEV = 'true';
  broadcast = await createNotificationBroadcastEntity();
});

const record = {
  id: '0123456789abcdef',
  type: 'announcement.posted',
  courseId: 'course-1',
  params: { courseId: 'course-1', announcementTitle: 'Hi' },
  occurredAt: '2026-11-14T00:00:00.000Z',
  dedupeKey: 'announcement-1',
};

describe('notificationBroadcast', () => {
  it('keys pk and sk by id', () => {
    const { Item } = broadcast.create(record).params() as {
      Item: Record<string, string>;
    };
    expect(Item.pk).toContain('0123456789abcdef');
    expect(Item.sk).toContain('0123456789abcdef');
  });

  it('starts pending, with no cursor', () => {
    const { Item } = broadcast.create(record).params();
    expect(Item).toMatchObject({ status: 'pending' });
    expect(Item).not.toHaveProperty('cursor');
  });

  it.each(['id', 'type', 'courseId', 'params', 'occurredAt', 'dedupeKey'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => broadcast.create(rest as never).params()).toThrow();
    },
  );

  it('refuses an unknown status', () => {
    expect(() =>
      broadcast.create({ ...record, status: 'stuck' } as never).params(),
    ).toThrow();
  });
});
