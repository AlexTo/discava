/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createCoreTableService } from '../service.js';
import { VersionConflictError } from './errors.js';
import {
  notificationBroadcastId,
  notificationId,
  notificationWrites,
  notifyCourseStudents,
  publishNotification,
} from './notification.js';
import { createFakeNotificationTable } from './notification-fake.test.js';
import { NotificationInputError } from './notification-types.js';

const AT = '2026-11-16T10:00:00.000Z';
const input = (over: Record<string, unknown> = {}) => ({
  type: 'assignment.returned',
  userId: 'student-1',
  params: {
    courseId: 'c1',
    lessonId: 'l1',
    assignmentTitle: 'Essay',
    courseTitle: 'History',
  },
  dedupeKey: 'item-1:2',
  occurredAt: AT,
  ...over,
});
const idOf = (over: Record<string, unknown> = {}) =>
  notificationId('assignment.returned', String(input(over).dedupeKey));

describe('ids', () => {
  it('are the first 16 hex characters of the documented hash', () => {
    expect(notificationId('a.b', 'k')).toMatch(/^[0-9a-f]{16}$/);
    expect(notificationId('a.b', 'k')).toBe(notificationId('a.b', 'k'));
    expect(notificationId('a.b', 'k')).not.toBe(notificationId('a.b', 'j'));
    // The NUL separator keeps ('ab', 'c') apart from ('a', 'bc').
    expect(notificationId('ab', 'c')).not.toBe(notificationId('a', 'bc'));
    expect(notificationBroadcastId('a.b', 'c1', 'k')).not.toBe(
      notificationId('a.b', 'k'),
    );
  });
});

describe('validation, before any write', () => {
  const rejects = [
    ['an unknown type', { type: 'nope.nothing' }],
    ['a missing param', { params: { courseId: 'c1' } }],
    ['an empty dedupeKey', { dedupeKey: '' }],
    ['an invalid occurredAt', { occurredAt: 'yesterday' }],
    [
      'an occurredAt without milliseconds',
      { occurredAt: '2026-11-16T10:00:00Z' },
    ],
  ] as const;

  it.each(rejects)(
    'rejects %s without touching the table',
    async (_n, over) => {
      const { service, log } = createFakeNotificationTable();
      const get = vi.spyOn(service.entities.notificationState, 'get');
      await expect(notificationWrites(service, input(over))).rejects.toThrow(
        NotificationInputError,
      );
      await expect(publishNotification(service, input(over))).rejects.toThrow(
        NotificationInputError,
      );
      expect(get).not.toHaveBeenCalled();
      expect(log.transactions).toBe(0);
    },
  );
});

describe('publishNotification', () => {
  it('creates one notification and a state with count 1 for a first publish', async () => {
    const { service, rows } = createFakeNotificationTable();
    expect(await publishNotification(service, input())).toBe('created');

    const [n] = [...rows.notification!.values()];
    expect(rows.notification!.size).toBe(1);
    expect(n).toMatchObject({
      userId: 'student-1',
      occurredAt: AT,
      id: idOf(),
      type: 'assignment.returned',
      link: { portal: 'student', path: '/learn/c1/lesson/l1' },
      email: { state: 'pending' },
    });
    expect(n.readAt).toBeUndefined();
    expect(rows.notificationState!.get('student-1')).toMatchObject({
      unreadCount: 1,
      version: 1,
    });
  });

  it('counts a second distinct publish and moves the state version', async () => {
    const { service, rows } = createFakeNotificationTable();
    await publishNotification(service, input());
    await publishNotification(
      service,
      input({ dedupeKey: 'item-2:1', occurredAt: '2026-11-16T10:05:00.000Z' }),
    );
    expect(rows.notification!.size).toBe(2);
    expect(rows.notificationState!.get('student-1')).toMatchObject({
      unreadCount: 2,
      version: 2,
    });
  });

  it('is one notification and one increment for the same key twice', async () => {
    const { service, rows } = createFakeNotificationTable();
    expect(await publishNotification(service, input())).toBe('created');
    expect(await publishNotification(service, input())).toBe('duplicate');
    expect(rows.notification!.size).toBe(1);
    expect(rows.notificationState!.get('student-1')).toMatchObject({
      unreadCount: 1,
      version: 1,
    });
  });

  it('makes one notification of concurrent identical publishes', async () => {
    const { service, rows } = createFakeNotificationTable();
    const results = await Promise.all([
      publishNotification(service, input()),
      publishNotification(service, input()),
      publishNotification(service, input()),
    ]);
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(2);
    expect(rows.notification!.size).toBe(1);
    expect(rows.notificationState!.get('student-1')!.unreadCount).toBe(1);
  });

  it('keeps every count when different notifications race for one user', async () => {
    const { service, rows } = createFakeNotificationTable();
    await Promise.all(
      ['a', 'b', 'c'].map((k, i) =>
        publishNotification(
          service,
          input({ dedupeKey: k, occurredAt: `2026-11-16T10:0${i}:00.000Z` }),
        ),
      ),
    );
    expect(rows.notification!.size).toBe(3);
    expect(rows.notificationState!.get('student-1')).toMatchObject({
      unreadCount: 3,
      version: 3,
    });
  });

  it('creates a late publish read, and leaves the count alone', async () => {
    const { service, rows } = createFakeNotificationTable();
    await publishNotification(service, input());
    const state = rows.notificationState!.get('student-1')!;
    state.readThrough = `2026-11-16T12:00:00.000Z#${'f'.repeat(16)}`;
    state.unreadCount = 0;

    const late = input({
      dedupeKey: 'late',
      occurredAt: '2026-11-16T11:00:00.000Z',
    });
    expect(await publishNotification(service, late)).toBe('created');

    const stored = rows.notification!.get(
      `student-1|${late.occurredAt}#${idOf({ dedupeKey: 'late' })}`,
    )!;
    expect(stored.readAt).toBe(late.occurredAt);
    expect(state).toMatchObject({ unreadCount: 0, version: 2 });
  });

  it('retries a version conflict, then throws after 3 retries', async () => {
    const { service, rows, hooks } = createFakeNotificationTable();
    await publishNotification(service, input());
    // Another writer bumps the version before each of our transactions.
    hooks.beforeTransaction = () => {
      rows.notificationState!.get('student-1')!.version++;
    };
    await expect(
      publishNotification(service, input({ dedupeKey: 'other' })),
    ).rejects.toThrow(VersionConflictError);
  });

  it('recovers when the conflict clears within the retries', async () => {
    const { service, rows, hooks } = createFakeNotificationTable();
    await publishNotification(service, input());
    let bumps = 2;
    hooks.beforeTransaction = () => {
      if (bumps-- > 0) rows.notificationState!.get('student-1')!.version++;
    };
    expect(
      await publishNotification(service, input({ dedupeKey: 'other' })),
    ).toBe('created');
  });
});

describe('notificationWrites', () => {
  it('composes into another transaction, and a cancelled outer one leaves nothing', async () => {
    const { service, rows } = createFakeNotificationTable();
    const items = await notificationWrites(service, input());
    expect(items).toHaveLength(2);

    // The producer's own item fails its condition, cancelling everything.
    const blocked = (service.entities.notificationState as any)
      .patch({ userId: 'nobody' })
      .add({ version: 1 })
      .commit();
    const { canceled } = await service.transaction
      .write(() => [blocked, ...(items as any)])
      .go();
    expect(canceled).toBe(true);
    expect(rows.notification!.size).toBe(0);
    expect(rows.notificationState!.size).toBe(0);

    const ok = await service.transaction.write(() => items).go();
    expect(ok.canceled).toBe(false);
    expect(rows.notification!.size).toBe(1);
  });
});

describe('the requests ElectroDB would send', () => {
  let real: Awaited<ReturnType<typeof createCoreTableService>>;
  beforeAll(async () => {
    process.env.LOCAL_DEV = 'true';
    real = await createCoreTableService();
  });

  const paramsFor = async (state: Record<string, unknown> | undefined) => {
    vi.spyOn(real.entities.notificationState, 'get').mockReturnValue({
      go: async () => ({ data: state }),
    } as never);
    const items = await notificationWrites(real, input());
    return real.transaction.write(() => items).params().TransactItems as any[];
  };

  it('creates the notification and the state, each only if absent', async () => {
    const [n, s] = await paramsFor(undefined);
    expect(n.Put.ConditionExpression).toContain('attribute_not_exists');
    expect(n.Put.Item).toMatchObject({
      sk: expect.stringContaining(`#id_${idOf()}`),
    });
    expect(s.Put.ConditionExpression).toContain('attribute_not_exists');
    expect(s.Put.Item).toMatchObject({ unreadCount: 1, version: 1 });
  });

  it('updates the state only at the version it read', async () => {
    const [, s] = await paramsFor({
      userId: 'student-1',
      unreadCount: 4,
      version: 7,
    });
    expect(s.Update.UpdateExpression).toMatch(/ADD .*unreadCount/);
    expect(Object.values(s.Update.ExpressionAttributeValues)).toContain(7);
    expect(s.Update.ConditionExpression).toMatch(/=/);
  });
});

describe('notifyCourseStudents', () => {
  const broadcast = {
    type: 'announcement.posted',
    courseId: 'c1',
    params: {
      courseId: 'c1',
      courseTitle: 'History',
      announcementTitle: 'Hello',
      excerpt: 'Welcome',
    },
    dedupeKey: 'ann-1',
    occurredAt: AT,
  };

  it('returns one create item that cancels a repeat', async () => {
    const { service, rows } = createFakeNotificationTable();
    const items = notifyCourseStudents(service, broadcast);
    expect(items).toHaveLength(1);
    expect((await service.transaction.write(() => items).go()).canceled).toBe(
      false,
    );
    expect(
      (
        await service.transaction
          .write(() => notifyCourseStudents(service, broadcast))
          .go()
      ).canceled,
    ).toBe(true);
    expect([...rows.notificationBroadcast!.values()][0]).toMatchObject({
      id: notificationBroadcastId('announcement.posted', 'c1', 'ann-1'),
      status: 'pending',
      dedupeKey: 'ann-1',
    });
  });

  it('rejects a missing key, a bad type, a missing param and an empty course', () => {
    const { service } = createFakeNotificationTable();
    for (const bad of [
      { dedupeKey: '' },
      { type: 'nope.nothing' },
      { params: {} },
      { courseId: '' },
      { occurredAt: 'x' },
    ]) {
      expect(() =>
        notifyCourseStudents(service, { ...broadcast, ...bad }),
      ).toThrow(NotificationInputError);
    }
  });
});
