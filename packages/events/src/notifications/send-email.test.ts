/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { EmailPermanentError, EmailTransientError } from './email.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeTable,
  type FakeNotification,
  fakeNotification,
} from './fake-notification-table.js';
import {
  CLAIM_LEASE_MS,
  EmailClaimHeldError,
  type EmailConfig,
  EmailTransientRetryError,
  sendNotificationEmail,
} from './send-email.js';

const fake = vi.hoisted(() => ({ transitions: {} as Record<string, unknown> }));
vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  claimEmail: (...args: unknown[]) =>
    (fake.transitions.claimEmail as never as (...a: unknown[]) => unknown)(
      ...args,
    ),
  skipEmail: (...args: unknown[]) =>
    (fake.transitions.skipEmail as never as (...a: unknown[]) => unknown)(
      ...args,
    ),
  markEmailSent: (...args: unknown[]) =>
    (fake.transitions.markEmailSent as never as (...a: unknown[]) => unknown)(
      ...args,
    ),
  markEmailFailed: (...args: unknown[]) =>
    (fake.transitions.markEmailFailed as never as (...a: unknown[]) => unknown)(
      ...args,
    ),
  markEmailUnknown: (...args: unknown[]) =>
    (
      fake.transitions.markEmailUnknown as never as (...a: unknown[]) => unknown
    )(...args),
  releaseEmailClaim: (...args: unknown[]) =>
    (
      fake.transitions.releaseEmailClaim as never as (
        ...a: unknown[]
      ) => unknown
    )(...args),
  readEmailState: (...args: unknown[]) =>
    (fake.transitions.readEmailState as never as (...a: unknown[]) => unknown)(
      ...args,
    ),
}));

const config: EmailConfig = {
  fromAddress: 'notifications@example.com',
  portalUrls: {
    student: 'https://student.example.com',
    instructor: 'https://instructor.example.com',
    admin: 'https://admin.example.com',
  },
  coreApiUrl: 'https://api.example.com/',
  unsubscribeSecret: async () => 'secret',
};

const NOW = Date.parse('2026-11-17T12:00:00.000Z');

let t: ReturnType<typeof createFakeTable>;
let n: FakeNotification;
const send = vi.fn();
const run = (overrides: Partial<EmailConfig> = {}, now = NOW) =>
  sendNotificationEmail(
    t.table,
    n,
    { ...config, ...overrides },
    send,
    () => now,
  );

beforeEach(() => {
  t = createFakeTable();
  Object.assign(fake.transitions, t.transitions);
  n = t.add(fakeNotification());
  t.users.set('u1', { email: 'alice@example.com' });
  send.mockReset();
  send.mockResolvedValue({ messageId: 'm1' });
});

describe('sendNotificationEmail', () => {
  it('sends one email for a pending notification and records it', async () => {
    expect(await run()).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0][0];
    expect(message).toMatchObject({
      to: 'alice@example.com',
      from: 'notifications@example.com',
      subject: 'Course: Hello',
    });
    expect(message.text).toContain('https://student.example.com/learn/c1/home');
    expect(message.headers['List-Unsubscribe']).toContain(
      'https://api.example.com/unsubscribe/',
    );
    // What people open is the student portal's page, not the API's JSON.
    expect(message.text).toContain(
      'https://student.example.com/unsubscribe?token=',
    );
    expect(message.text).not.toContain('https://api.example.com');
    expect(n.email).toMatchObject({
      state: 'sent',
      messageId: 'm1',
      sentAt: '2026-11-17T12:00:00.000Z',
    });
  });

  it('sends nothing the second time', async () => {
    await run();
    expect(await run()).toBe('already-handled');
    expect(send).toHaveBeenCalledOnce();
  });

  it('sends nothing for a notification that does not exist', async () => {
    t.notifications.clear();
    expect(await run()).toBe('already-handled');
    expect(send).not.toHaveBeenCalled();
  });

  it('skips when the user opted out', async () => {
    t.preferences.set('u1|announcement.posted', { emailEnabled: false });
    expect(await run()).toBe('skipped');
    expect(n.email).toEqual({ state: 'skipped', reason: 'opted-out' });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips when the user has no address', async () => {
    t.users.set('u1', {});
    await run();
    expect(n.email).toEqual({ state: 'skipped', reason: 'no-address' });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips when the user does not exist', async () => {
    t.users.clear();
    await run();
    expect(n.email.reason).toBe('no-address');
  });

  it('skips when the stage has no sender', async () => {
    await run({ fromAddress: undefined });
    expect(n.email).toEqual({ state: 'skipped', reason: 'not-configured' });
    expect(send).not.toHaveBeenCalled();
  });

  it('skips a type whose policy is never', async () => {
    const { NOTIFICATION_TYPES } = await import('@discava/core-table');
    const original = NOTIFICATION_TYPES['announcement.posted'];
    NOTIFICATION_TYPES['announcement.posted'] = {
      ...original,
      emailPolicy: 'never',
    };
    try {
      await run();
    } finally {
      NOTIFICATION_TYPES['announcement.posted'] = original;
    }
    expect(n.email).toEqual({ state: 'skipped', reason: 'never' });
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores an opt-out for a required type', async () => {
    const { NOTIFICATION_TYPES } = await import('@discava/core-table');
    const original = NOTIFICATION_TYPES['announcement.posted'];
    NOTIFICATION_TYPES['announcement.posted'] = {
      ...original,
      emailPolicy: 'required',
    };
    t.preferences.set('u1|announcement.posted', { emailEnabled: false });
    try {
      expect(await run()).toBe('sent');
    } finally {
      NOTIFICATION_TYPES['announcement.posted'] = original;
    }
  });

  it('skips a default-off type with no stored preference, and sends once opted in', async () => {
    n = t.add(
      fakeNotification({
        id: '0123456789abcdef',
        type: 'review.received',
        link: { portal: 'instructor', path: '/my-courses/c1/reviews' },
      }),
    );
    await run();
    expect(n.email).toEqual({ state: 'skipped', reason: 'opted-out' });

    n = t.add(
      fakeNotification({
        id: 'fedcba9876543210',
        type: 'review.received',
        link: { portal: 'instructor', path: '/my-courses/c1/reviews' },
      }),
    );
    t.preferences.set('u1|review.received', { emailEnabled: true });
    expect(await run()).toBe('sent');
    expect(send.mock.calls[0][0].text).toContain(
      'https://instructor.example.com/',
    );
  });

  it('throws, and sends nothing, when another delivery holds a fresh claim', async () => {
    n.email = {
      state: 'sending',
      claimedAt: new Date(NOW - 60_000).toISOString(),
    };
    await expect(run()).rejects.toThrow(EmailClaimHeldError);
    expect(send).not.toHaveBeenCalled();
    expect(n.email.state).toBe('sending');
  });

  it('marks a stale claim unknown and sends nothing', async () => {
    n.email = {
      state: 'sending',
      claimedAt: new Date(NOW - CLAIM_LEASE_MS - 1000).toISOString(),
    };
    expect(await run()).toBe('unknown');
    expect(n.email.state).toBe('unknown');
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves sending after a crash following the send, then marks unknown after the lease', async () => {
    t.transitions.markEmailSent.mockRejectedValueOnce(new Error('crash'));
    await expect(run()).rejects.toThrow('crash');
    expect(n.email.state).toBe('sending');
    expect(send).toHaveBeenCalledOnce();

    await expect(run()).rejects.toThrow(EmailClaimHeldError);
    expect(await run({}, NOW + CLAIM_LEASE_MS + 1000)).toBe('unknown');
    expect(send).toHaveBeenCalledOnce();
  });

  it('releases the claim and throws on a transient error, so a retry sends', async () => {
    send.mockRejectedValueOnce(new EmailTransientError('throttled'));
    await expect(run()).rejects.toThrow(EmailTransientRetryError);
    expect(n.email.state).toBe('pending');
    expect(await run()).toBe('sent');
  });

  it('records failed on a permanent error', async () => {
    send.mockRejectedValueOnce(new EmailPermanentError('rejected'));
    expect(await run()).toBe('failed');
    expect(n.email).toEqual({ state: 'failed', reason: 'rejected' });
    expect(await run()).toBe('already-handled');
    expect(send).toHaveBeenCalledOnce();
  });
});
