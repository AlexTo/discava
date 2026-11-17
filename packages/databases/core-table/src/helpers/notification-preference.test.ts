/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { InvalidRequestError, NotFoundError } from './errors.js';
import { setNotificationPreference } from './notification-preference.js';
import { NOTIFICATION_TYPES } from './notification-types.js';

const fakeService = () => {
  const puts: Record<string, unknown>[] = [];
  const service = {
    entities: {
      notificationPreference: {
        put: (item: Record<string, unknown>) => ({
          go: vi.fn(async () => {
            puts.push(item);
            return { data: item };
          }),
        }),
      },
    },
  } as any;
  return { service, puts };
};

describe('setNotificationPreference', () => {
  it('stores the choice and returns the registry entry', async () => {
    const { service, puts } = fakeService();
    const entry = await setNotificationPreference(
      service,
      'u1',
      'discussion.reply',
      false,
    );
    expect(puts).toEqual([
      { userId: 'u1', type: 'discussion.reply', emailEnabled: false },
    ]);
    expect(entry.id).toBe('discussion.reply');
  });

  it('allows writing the registry default', async () => {
    const { service, puts } = fakeService();
    await setNotificationPreference(service, 'u1', 'review.received', false);
    expect(puts).toHaveLength(1);
  });

  it('refuses an unknown type, including inherited property names', async () => {
    const { service, puts } = fakeService();
    for (const type of ['nope.nope', 'constructor', '__proto__']) {
      await expect(
        setNotificationPreference(service, 'u1', type, true),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(puts).toHaveLength(0);
  });

  it('refuses required and never types without writing', async () => {
    const { service, puts } = fakeService();
    const base = NOTIFICATION_TYPES['assignment.returned']!;
    try {
      NOTIFICATION_TYPES['test.required'] = {
        ...base,
        id: 'test.required',
        emailPolicy: 'required',
      };
      NOTIFICATION_TYPES['test.never'] = {
        ...base,
        id: 'test.never',
        emailPolicy: 'never',
      };
      for (const type of ['test.required', 'test.never']) {
        await expect(
          setNotificationPreference(service, 'u1', type, false),
        ).rejects.toBeInstanceOf(InvalidRequestError);
      }
      expect(puts).toHaveLength(0);
    } finally {
      delete NOTIFICATION_TYPES['test.required'];
      delete NOTIFICATION_TYPES['test.never'];
    }
  });
});
