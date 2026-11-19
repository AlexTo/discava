/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createNotificationStateEntity } from './notification-state.js';

let state: Awaited<ReturnType<typeof createNotificationStateEntity>>;
beforeAll(async () => {
  state = await createNotificationStateEntity();
});

const record = { userId: 'user-1', unreadCount: 1, version: 1 };

describe('notificationState', () => {
  it('keys pk and sk by user', () => {
    const { Item } = state.create(record).params() as {
      Item: Record<string, string>;
    };
    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain('user-1');
  });

  it.each(['userId', 'unreadCount', 'version'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => state.create(rest as never).params()).toThrow();
    },
  );

  it('does not need readThrough', () => {
    expect(() => state.create(record).params()).not.toThrow();
  });
});
