/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createNotificationEntity } from './notification.js';

// The requests ElectroDB would send, checked without a table.

let notification: Awaited<ReturnType<typeof createNotificationEntity>>;
beforeAll(async () => {
  notification = await createNotificationEntity();
});

const record = {
  userId: 'user-1',
  occurredAt: '2026-11-14T00:00:00.000Z',
  id: '0123456789abcdef',
  type: 'assignment.returned',
  title: 'Returned',
  body: 'Your work was returned',
  link: { portal: 'student' as const, path: '/learn/c/lesson/l' },
};

describe('notification', () => {
  it('keys by user, then occurredAt and id', () => {
    const { Item } = notification.create(record).params() as {
      Item: Record<string, string>;
    };

    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain(
      'occurredat_2026-11-14t00:00:00.000z#id_0123456789abcdef',
    );
    expect(Item.sk.endsWith('0123456789abcdef')).toBe(true);
    expect(Item.sk.indexOf('2026')).toBeLessThan(Item.sk.indexOf('0123'));
  });

  it.each(['userId', 'occurredAt', 'id', 'type', 'title', 'body', 'link'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => notification.create(rest as never).params()).toThrow();
    },
  );

  it('starts with a pending email', () => {
    const { Item } = notification.create(record).params();
    expect(Item).toMatchObject({ email: { state: 'pending' } });
  });

  it.each(['student', 'instructor', 'admin'] as const)(
    'accepts the %s portal',
    (portal) => {
      expect(() =>
        notification
          .create({ ...record, link: { portal, path: '/x' } })
          .params(),
      ).not.toThrow();
    },
  );

  it('refuses an unknown portal', () => {
    expect(() =>
      notification
        .create({ ...record, link: { portal: 'other', path: '/x' } } as never)
        .params(),
    ).toThrow();
  });

  it('refuses a link path that does not start with /', () => {
    expect(() =>
      notification
        .create({ ...record, link: { portal: 'student', path: 'x' } })
        .params(),
    ).toThrow();
  });

  it.each(['pending', 'sending', 'sent', 'skipped', 'failed', 'unknown'])(
    'accepts the %s email state',
    (state) => {
      expect(() =>
        notification.create({ ...record, email: { state } } as never).params(),
      ).not.toThrow();
    },
  );

  it('refuses an unknown email state', () => {
    expect(() =>
      notification
        .create({ ...record, email: { state: 'queued' } } as never)
        .params(),
    ).toThrow();
  });
});
