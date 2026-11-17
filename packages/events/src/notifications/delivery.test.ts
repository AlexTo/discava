/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationDelivery } from './delivery.js';
import {
  createFakeTable,
  fakeNotification,
} from './fake-notification-table.js';
import type { EmailConfig } from './send-email.js';

const mocks = vi.hoisted(() => ({
  fanOut: vi.fn(),
  send: vi.fn(),
  transitions: {} as Record<string, (...args: never[]) => unknown>,
}));
vi.mock('./fan-out.js', () => ({ fanOutBroadcast: mocks.fanOut }));
vi.mock('@discava/common-server-utils/email', async (importActual) => ({
  ...(await importActual<
    typeof import('@discava/common-server-utils/email')
  >()),
  sendEmail: mocks.send,
}));
vi.mock('@discava/core-table', async (importActual) => {
  const actual = await importActual<typeof import('@discava/core-table')>();
  const via =
    (name: string) =>
    (...args: never[]) =>
      mocks.transitions[name](...args);
  return {
    ...actual,
    claimEmail: via('claimEmail'),
    skipEmail: via('skipEmail'),
    markEmailSent: via('markEmailSent'),
    markEmailFailed: via('markEmailFailed'),
    markEmailUnknown: via('markEmailUnknown'),
    releaseEmailClaim: via('releaseEmailClaim'),
    readEmailState: via('readEmailState'),
  };
});

const config: EmailConfig = {
  fromAddress: 'notifications@example.com',
  portalUrls: {
    student: 'https://s',
    instructor: 'https://i',
    admin: 'https://a',
  },
  coreApiUrl: 'https://api',
  unsubscribeSecret: async () => 'secret',
};

const record = (
  eventName: 'INSERT' | 'MODIFY',
  image: Record<string, unknown>,
) => ({ eventName, dynamodb: { NewImage: image } });
const batch = (...records: ReturnType<typeof record>[]) =>
  ({ Records: records }) as never;

const notificationInsert = (id: string, userId = 'u1') =>
  record('INSERT', {
    __edb_e__: 'notification',
    userId,
    occurredAt: '2026-11-17T00:00:00.000Z',
    id,
  });
const broadcastInsert = (id = 'b1') =>
  record('INSERT', { __edb_e__: 'notificationBroadcast', id });

let t: ReturnType<typeof createFakeTable>;
beforeEach(() => {
  t = createFakeTable();
  Object.assign(mocks.transitions, t.transitions);
  t.users.set('u1', { email: 'alice@example.com' });
  t.add(fakeNotification({ id: 'aaaaaaaaaaaaaaaa' }));
  t.add(fakeNotification({ id: 'bbbbbbbbbbbbbbbb' }));
  mocks.fanOut.mockReset();
  mocks.send.mockReset();
  mocks.send.mockResolvedValue({ messageId: 'm1' });
});

const states = () =>
  [...t.notifications.values()].map(({ id, email }) => [id, email.state]);

describe('notificationDelivery', () => {
  it('routes a notification INSERT to the email and a broadcast INSERT to the fan-out', async () => {
    await notificationDelivery(
      t.table,
      batch(notificationInsert('aaaaaaaaaaaaaaaa'), broadcastInsert('b9')),
      config,
    );
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.fanOut).toHaveBeenCalledWith(t.table, 'b9');
  });

  it('sends nothing for a stream record delivered twice', async () => {
    const event = batch(
      notificationInsert('aaaaaaaaaaaaaaaa'),
      notificationInsert('aaaaaaaaaaaaaaaa'),
    );
    await notificationDelivery(t.table, event, config);
    await notificationDelivery(t.table, event, config);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('ignores a MODIFY record', async () => {
    const result = await notificationDelivery(
      t.table,
      batch(
        record('MODIFY', {
          __edb_e__: 'notification',
          userId: 'u1',
          occurredAt: '2026-11-17T00:00:00.000Z',
          id: 'aaaaaaaaaaaaaaaa',
        }),
      ),
      config,
    );
    expect(result).toEqual({ handled: 0, ignored: 1 });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('handles the rest of the batch when a record fails, then throws', async () => {
    mocks.send
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ messageId: 'm2' });
    await expect(
      notificationDelivery(
        t.table,
        batch(
          notificationInsert('aaaaaaaaaaaaaaaa'),
          notificationInsert('bbbbbbbbbbbbbbbb'),
          broadcastInsert(),
        ),
        config,
      ),
    ).rejects.toThrow();
    expect(mocks.fanOut).toHaveBeenCalledOnce();
    expect(states()).toEqual([
      ['aaaaaaaaaaaaaaaa', 'pending'],
      ['bbbbbbbbbbbbbbbb', 'sent'],
    ]);
  });

  it('throws when the fan-out fails, after handling the other records', async () => {
    mocks.fanOut.mockRejectedValueOnce(new Error('page 2'));
    await expect(
      notificationDelivery(
        t.table,
        batch(broadcastInsert(), notificationInsert('aaaaaaaaaaaaaaaa')),
        config,
      ),
    ).rejects.toThrow('page 2');
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('ends in the same state for the same batch twice, and in either record order', async () => {
    const forward = batch(
      notificationInsert('aaaaaaaaaaaaaaaa'),
      broadcastInsert(),
      notificationInsert('bbbbbbbbbbbbbbbb'),
    );
    await notificationDelivery(t.table, forward, config);
    await notificationDelivery(t.table, forward, config);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(states()).toEqual([
      ['aaaaaaaaaaaaaaaa', 'sent'],
      ['bbbbbbbbbbbbbbbb', 'sent'],
    ]);

    // The same records with the broadcast before them, on fresh state.
    t = createFakeTable();
    Object.assign(mocks.transitions, t.transitions);
    t.users.set('u1', { email: 'alice@example.com' });
    t.add(fakeNotification({ id: 'aaaaaaaaaaaaaaaa' }));
    t.add(fakeNotification({ id: 'bbbbbbbbbbbbbbbb' }));
    mocks.send.mockClear();
    await notificationDelivery(
      t.table,
      batch(
        broadcastInsert(),
        notificationInsert('aaaaaaaaaaaaaaaa'),
        notificationInsert('bbbbbbbbbbbbbbbb'),
      ),
      config,
    );
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(states()).toEqual([
      ['aaaaaaaaaaaaaaaa', 'sent'],
      ['bbbbbbbbbbbbbbbb', 'sent'],
    ]);
  });
});
