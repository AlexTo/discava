/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createNotificationPreferenceEntity } from './notification-preference.js';

let preference: Awaited<ReturnType<typeof createNotificationPreferenceEntity>>;
beforeAll(async () => {
  preference = await createNotificationPreferenceEntity();
});

const record = {
  userId: 'user-1',
  type: 'assignment.returned',
  emailEnabled: false,
};

describe('notificationPreference', () => {
  it('keys by user, then type', () => {
    const { Item } = preference.create(record).params() as {
      Item: Record<string, string>;
    };
    expect(Item.pk).toContain('user-1');
    expect(Item.sk).toContain('assignment.returned');
  });

  it.each(['userId', 'type', 'emailEnabled'])(
    'is refused without its %s',
    (field) => {
      const { [field as keyof typeof record]: _, ...rest } = record;
      expect(() => preference.create(rest as never).params()).toThrow();
    },
  );
});
