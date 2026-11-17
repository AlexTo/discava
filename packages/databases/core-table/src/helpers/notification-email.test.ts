/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { publishNotification } from './notification.js';
import {
  claimEmail,
  markEmailFailed,
  markEmailSent,
  markEmailUnknown,
  type NotificationKey,
  readEmailState,
  releaseEmailClaim,
  skipEmail,
} from './notification-email.js';
import { createFakeNotificationTable } from './notification-fake.test.js';

const AT = '2026-11-16T10:00:00.000Z';
const T = '2026-11-16T10:00:05.000Z';

const setup = async () => {
  const fake = createFakeNotificationTable();
  await publishNotification(fake.service, {
    type: 'assignment.returned',
    userId: 'u1',
    params: {
      courseId: 'c1',
      lessonId: 'l1',
      assignmentTitle: 'Essay',
      courseTitle: 'History',
    },
    dedupeKey: 'k',
    occurredAt: AT,
  });
  const row = [...fake.rows.notification!.values()][0]!;
  const key: NotificationKey = {
    userId: 'u1',
    occurredAt: row.occurredAt,
    id: row.id,
  };
  const state = () => readEmailState(fake.service, key);
  return { service: fake.service, key, state, row };
};

describe('legal email transitions', () => {
  it('pending to skipped, with the reason', async () => {
    const { service, key, state } = await setup();
    expect(await skipEmail(service, key, 'opted-out')).toBe(true);
    expect(await state()).toEqual({ state: 'skipped', reason: 'opted-out' });
  });

  it('pending to sending, with the claim time', async () => {
    const { service, key, state } = await setup();
    expect(await claimEmail(service, key, T)).toBe(true);
    expect(await state()).toEqual({ state: 'sending', claimedAt: T });
  });

  it('sending to sent, with the message id and time', async () => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    expect(await markEmailSent(service, key, 'm-1', T)).toBe(true);
    expect(await state()).toMatchObject({
      state: 'sent',
      messageId: 'm-1',
      sentAt: T,
    });
  });

  it('sending to failed, with the reason', async () => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    expect(await markEmailFailed(service, key, 'rejected')).toBe(true);
    expect(await state()).toMatchObject({
      state: 'failed',
      reason: 'rejected',
    });
  });

  it('sending back to pending when the claim is released, and it can be claimed again', async () => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    expect(await releaseEmailClaim(service, key)).toBe(true);
    expect(await state()).toEqual({ state: 'pending' });
    expect(await claimEmail(service, key, T)).toBe(true);
  });

  it('sending to unknown', async () => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    expect(await markEmailUnknown(service, key)).toBe(true);
    expect(await state()).toEqual({ state: 'unknown' });
  });
});

describe('illegal email transitions are refused and change nothing', () => {
  it('refuses a second claim', async () => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    expect(await claimEmail(service, key, '2026-11-16T11:00:00.000Z')).toBe(
      false,
    );
    expect(await state()).toEqual({ state: 'sending', claimedAt: T });
  });

  it('refuses sent, failed, release and unknown from pending', async () => {
    const { service, key, state } = await setup();
    expect(await markEmailSent(service, key, 'm', T)).toBe(false);
    expect(await markEmailFailed(service, key, 'r')).toBe(false);
    expect(await releaseEmailClaim(service, key)).toBe(false);
    expect(await markEmailUnknown(service, key)).toBe(false);
    expect(await state()).toEqual({ state: 'pending' });
  });

  it.each([
    ['sent', (s: any, k: NotificationKey) => markEmailSent(s, k, 'm-1', T)],
    ['failed', (s: any, k: NotificationKey) => markEmailFailed(s, k, 'r')],
    ['unknown', (s: any, k: NotificationKey) => markEmailUnknown(s, k)],
  ])('keeps %s final', async (_name, finish) => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    await finish(service, key);
    const final = await state();

    expect(await claimEmail(service, key, T)).toBe(false);
    expect(await skipEmail(service, key, 'never')).toBe(false);
    expect(await releaseEmailClaim(service, key)).toBe(false);
    expect(await markEmailFailed(service, key, 'x')).toBe(false);
    expect(await markEmailUnknown(service, key)).toBe(false);
    expect(await state()).toEqual(final);
  });

  it('keeps skipped final', async () => {
    const { service, key, state } = await setup();
    await skipEmail(service, key, 'no-address');
    expect(await claimEmail(service, key, T)).toBe(false);
    expect(await skipEmail(service, key, 'never')).toBe(false);
    expect(await state()).toEqual({ state: 'skipped', reason: 'no-address' });
  });

  it('does not overwrite the first messageId with a duplicate markEmailSent', async () => {
    const { service, key, state } = await setup();
    await claimEmail(service, key, T);
    await markEmailSent(service, key, 'first', T);
    expect(
      await markEmailSent(service, key, 'second', '2026-11-16T12:00:00.000Z'),
    ).toBe(false);
    expect(await state()).toMatchObject({
      state: 'sent',
      messageId: 'first',
      sentAt: T,
    });
  });

  it('lets only one of two racing claims win', async () => {
    const { service, key } = await setup();
    const results = await Promise.all([
      claimEmail(service, key, T),
      claimEmail(service, key, T),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('readEmailState', () => {
  it('is undefined for a notification that does not exist', async () => {
    const { service } = await setup();
    expect(
      await readEmailState(service, {
        userId: 'u1',
        occurredAt: AT,
        id: 'f'.repeat(16),
      }),
    ).toBeUndefined();
  });
});

// The request ElectroDB sends, checked without a table.
describe('the real patch', () => {
  beforeAll(() => {
    process.env.LOCAL_DEV = 'true';
  });

  it('replaces the email map only from the previous state', async () => {
    process.env.LOCAL_DEV = 'true';
    const real = await createCoreTableService();
    const patch = vi.spyOn(real.entities.notification, 'patch');
    const params = real.entities.notification
      .patch({ userId: 'u1', occurredAt: AT, id: 'a'.repeat(16) })
      .set({ email: { state: 'sending', claimedAt: T } })
      .where((attr, op) => op.eq(attr.email.state, 'pending'))
      .params() as any;

    expect(patch).toHaveBeenCalled();
    expect(params.ConditionExpression).toContain('#email');
    expect(Object.values(params.ExpressionAttributeValues)).toContain(
      'pending',
    );
  });
});
