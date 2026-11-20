/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { InvalidRequestError, NotFoundError } from './errors.js';
import {
  isEmailEnabled,
  setNotificationPreference,
} from './notification-preference.js';
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

  it('refuses a type that follows another type’s setting', async () => {
    const { service, puts } = fakeService();
    await expect(
      setNotificationPreference(service, 'u1', 'certificate.reminder', false),
    ).rejects.toBeInstanceOf(InvalidRequestError);
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

describe('isEmailEnabled', () => {
  const serviceWith = (stored: Record<string, boolean> = {}) =>
    ({
      entities: {
        notificationPreference: {
          get: ({ type }: { type: string }) => ({
            go: async () => ({
              data:
                type in stored
                  ? { userId: 'u1', type, emailEnabled: stored[type] }
                  : null,
            }),
          }),
        },
      },
    }) as any;

  it('is false for an unknown type, including inherited names', async () => {
    for (const type of ['nope.nope', 'constructor', '__proto__']) {
      expect(await isEmailEnabled(serviceWith(), 'u1', type)).toBe(false);
    }
  });

  it('is false for a never type and true for a required one', async () => {
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
      const service = serviceWith({ 'test.required': false });
      expect(await isEmailEnabled(service, 'u1', 'test.required')).toBe(true);
      expect(await isEmailEnabled(service, 'u1', 'test.never')).toBe(false);
    } finally {
      delete NOTIFICATION_TYPES['test.required'];
      delete NOTIFICATION_TYPES['test.never'];
    }
  });

  it('uses the policy default when nothing is stored', async () => {
    expect(await isEmailEnabled(serviceWith(), 'u1', 'discussion.reply')).toBe(
      true,
    );
    expect(
      await isEmailEnabled(serviceWith(), 'u1', 'discussion.accepted'),
    ).toBe(false);
  });

  it('uses the stored choice over the default', async () => {
    expect(
      await isEmailEnabled(
        serviceWith({ 'discussion.reply': false, 'review.received': true }),
        'u1',
        'discussion.reply',
      ),
    ).toBe(false);
    expect(
      await isEmailEnabled(
        serviceWith({ 'review.received': true }),
        'u1',
        'review.received',
      ),
    ).toBe(true);
  });

  it('answers for the reminder as for certificate.issued: on, off and unset', async () => {
    expect(
      await isEmailEnabled(
        serviceWith({ 'certificate.issued': true }),
        'u1',
        'certificate.reminder',
      ),
    ).toBe(true);
    expect(
      await isEmailEnabled(
        serviceWith({ 'certificate.issued': false }),
        'u1',
        'certificate.reminder',
      ),
    ).toBe(false);
    expect(
      await isEmailEnabled(serviceWith(), 'u1', 'certificate.reminder'),
    ).toBe(true);
  });

  it('ignores a stored preference for the reminder itself', async () => {
    expect(
      await isEmailEnabled(
        serviceWith({ 'certificate.reminder': false }),
        'u1',
        'certificate.reminder',
      ),
    ).toBe(true);
  });
});
