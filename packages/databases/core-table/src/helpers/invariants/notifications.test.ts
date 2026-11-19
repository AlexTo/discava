/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_TYPES } from '../notification-types.js';
import type { TableSnapshot } from './snapshot.js';
import {
  AT,
  checkTableInvariants,
  consistentTable,
  testHelpers,
} from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { broken, expectOnly } = testHelpers(() => table);

describe('notifications', () => {
  const NOW = '2026-11-16T12:00:00.000Z';
  const ID = 'a1b2c3d4e5f60718';
  const POSITION = `2026-11-16T10:00:00.000Z#${ID}`;

  const notification = (
    over: Partial<TableSnapshot['notifications'][number]> = {},
  ): TableSnapshot['notifications'][number] => ({
    userId: 'student',
    occurredAt: '2026-11-16T10:00:00.000Z',
    id: ID,
    type: 'assignment.returned',
    link: { portal: 'student', path: '/learn/c1/lesson/l1' },
    email: { state: 'skipped', reason: 'never' },
    createdAt: '2026-11-16T10:00:00.000Z',
    ...over,
  });

  // One unread notification and its state, which is consistent.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    table.notifications = [notification()];
    table.notificationStates = [{ userId: 'student', unreadCount: 1 }];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('finds nothing wrong with a clean table', () => {
    expect(checkTableInvariants(table)).toEqual([]);
  });

  describe('notification-unread-count-matches', () => {
    it('reports a count too high', () => {
      table.notificationStates[0].unreadCount = 2;
      expectOnly('notification-unread-count-matches', /2, but 1 notifications/);
    });

    it('reports a count too low', () => {
      table.notificationStates[0].unreadCount = 0;
      expectOnly('notification-unread-count-matches', /0, but 1 notifications/);
    });

    it('does not count what is read, by readAt or by readThrough', () => {
      table.notifications = [
        notification({ readAt: NOW }),
        notification({
          id: 'b'.repeat(16),
          occurredAt: '2026-11-16T09:00:00.000Z',
        }),
        notification({
          id: 'c'.repeat(16),
          occurredAt: '2026-11-16T11:00:00.000Z',
        }),
      ];
      // 09:00 is at or before readThrough, the first has readAt; only 11:00
      // is unread.
      table.notificationStates = [
        {
          userId: 'student',
          unreadCount: 1,
          readThrough: `2026-11-16T09:30:00.000Z#${'0'.repeat(16)}`,
        },
      ];
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('notification-shape', () => {
    it('reports a sort key that is not <occurredAt>#<id>', () => {
      table.notifications[0].id = 'not-hex';
      expectOnly('notification-shape', /sort key/);

      table = consistentTable();
      table.notifications = [notification({ occurredAt: '2026-11-16' })];
      table.notificationStates = [{ userId: 'student', unreadCount: 1 }];
      expectOnly('notification-shape', /sort key/);
    });

    it('reports an unregistered type, and a path without a leading slash', () => {
      table.notifications[0].type = 'nope.nothing';
      expectOnly('notification-shape', /not registered/);

      table.notifications[0].type = 'assignment.returned';
      table.notifications[0].link = { portal: 'student', path: 'learn' };
      expectOnly('notification-shape', /does not start with/);
    });

    it('reports a sent email without a message id', () => {
      table.notifications[0].email = { state: 'sent', sentAt: NOW };
      expectOnly('notification-shape', /sent without sentAt and messageId/);
    });

    it('reports skipped and failed emails without a reason', () => {
      table.notifications[0].email = { state: 'skipped' };
      expectOnly('notification-shape', /skipped without a reason/);
      table.notifications[0].email = { state: 'failed' };
      expectOnly('notification-shape', /failed without a reason/);
    });

    it('reports an email sending for over an hour, not one just claimed', () => {
      table.notifications[0].email = {
        state: 'sending',
        claimedAt: '2026-11-16T10:30:00.000Z',
      };
      expectOnly('notification-shape', /sending for over an hour/);

      table.notifications[0].email = { state: 'sending', claimedAt: NOW };
      expect(broken().invariants).toEqual([]);
    });

    it('reports a pending email over an hour old', () => {
      table.notifications[0].email = { state: 'pending' };
      table.notifications[0].createdAt = '2026-11-16T10:30:00.000Z';
      expectOnly('notification-shape', /still pending/);
    });

    it('passes a pending email that was just created', () => {
      table.notifications[0].email = { state: 'pending' };
      table.notifications[0].createdAt = '2026-11-16T11:59:00.000Z';
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('notification-state-exists', () => {
    it('reports a user with notifications and no state', () => {
      table.notificationStates = [];
      expectOnly('notification-state-exists', /no notificationState/);
    });

    it('reports a negative count', () => {
      table.notifications = [];
      table.notificationStates[0].unreadCount = -1;
      const { violations } = broken();
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(/-1 is not a count/),
      );
    });

    it('reports a readThrough that is not a position', () => {
      table.notifications[0].readAt = NOW;
      table.notificationStates[0] = {
        userId: 'student',
        unreadCount: 0,
        readThrough: 'yesterday',
      };
      expectOnly('notification-state-exists', /not a position/);
    });

    it('accepts a valid readThrough', () => {
      table.notificationStates[0] = {
        userId: 'student',
        unreadCount: 0,
        readThrough: POSITION,
      };
      expect(broken().invariants).toEqual([]);
    });
  });

  describe('notification-preference-shape', () => {
    it('accepts a preference for a registered type that can change', () => {
      table.notificationPreferences = [
        { userId: 'student', type: 'review.received' },
      ];
      expect(broken().invariants).toEqual([]);
    });

    it('reports an unregistered type', () => {
      table.notificationPreferences = [{ userId: 'student', type: 'nope.x' }];
      expectOnly('notification-preference-shape', /not registered/);
    });

    it('reports a preference for a required type', () => {
      const type = 'test.required';
      NOTIFICATION_TYPES[type] = {
        id: type,
        name: 'Required',
        description: 'Always sent',
        params: [],
        emailPolicy: 'required',
        build: () => ({
          title: 't',
          body: 'b',
          link: { portal: 'student', path: '/' },
        }),
      };
      try {
        table.notificationPreferences = [{ userId: 'student', type }];
        expectOnly('notification-preference-shape', /required/);
      } finally {
        delete NOTIFICATION_TYPES[type];
      }
    });
  });

  describe('notification-broadcast-done-complete', () => {
    const broadcast = (
      over: Partial<TableSnapshot['notificationBroadcasts'][number]>,
    ): TableSnapshot['notificationBroadcasts'][number] => ({
      id: 'b'.repeat(16),
      type: 'announcement.posted',
      courseId: 'c1',
      dedupeKey: 'k',
      occurredAt: '2026-11-16T11:59:00.000Z',
      status: 'pending',
      createdAt: '2026-11-16T11:59:00.000Z',
      ...over,
    });

    it('passes a done broadcast with completedAt, and a recent pending one', () => {
      table.notificationBroadcasts = [
        broadcast({ status: 'done', completedAt: NOW }),
        broadcast({ id: 'c'.repeat(16) }),
      ];
      expect(broken().invariants).toEqual([]);
    });

    it('reports a done broadcast without completedAt', () => {
      table.notificationBroadcasts = [broadcast({ status: 'done' })];
      expectOnly('notification-broadcast-done-complete', /without completedAt/);
    });

    it('reports a stuck broadcast', () => {
      table.notificationBroadcasts = [
        broadcast({ createdAt: '2026-11-16T10:00:00.000Z' }),
      ];
      expectOnly('notification-broadcast-done-complete', /over an hour/);
    });
  });

  describe('announcement-shape', () => {
    const AT = '2026-11-15T10:00:00.000Z';
    const ID = `${new Date(AT)
      .getTime()
      .toString(16)
      .padStart(12, '0')
      .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-000000000001`;
    const announcement = (
      over: Partial<TableSnapshot['announcements'][number]> = {},
    ): TableSnapshot['announcements'][number] => ({
      courseId: 'c1',
      announcementId: ID,
      title: 'Welcome',
      body: '{"type":"doc","content":[{"type":"paragraph"}]}',
      authorId: 'instructor',
      createdAt: AT,
      version: 1,
      ...over,
    });
    const broadcastFor = (a: TableSnapshot['announcements'][number]) => ({
      id: 'b'.repeat(16),
      type: 'announcement.posted',
      courseId: a.courseId,
      dedupeKey: a.announcementId,
      occurredAt: a.createdAt,
      status: 'done' as const,
      completedAt: NOW,
      createdAt: a.createdAt,
    });
    const hold = (a: TableSnapshot['announcements'][number]) => {
      table.announcements = [a];
      table.notificationBroadcasts = [broadcastFor(a)];
    };

    it('passes a well-formed announcement, edited or not', () => {
      hold(announcement());
      expect(broken().invariants).toEqual([]);
      hold(announcement({ version: 3, editedAt: '2026-11-15T11:00:00.000Z' }));
      expect(broken().invariants).toEqual([]);
    });

    it.each([
      [
        'its course does not exist',
        { courseId: 'gone' },
        /course does not exist/,
      ],
      ['an id that is not a UUID v7', { announcementId: 'nope' }, /UUID v7/],
      [
        'a createdAt other than the id time',
        { createdAt: '2026-11-15T10:00:01.000Z' },
        /UUID v7/,
      ],
      ['an empty title', { title: '  ' }, /title/],
      ['a title over 120 characters', { title: 'x'.repeat(121) }, /title/],
      ['a body that is not JSON', { body: 'plain' }, /body/],
      [
        'a body that is not a document',
        { body: '{"type":"paragraph"}' },
        /body/,
      ],
      [
        'a body over 20,000 characters',
        { body: `{"type":"doc","pad":"${'x'.repeat(20_000)}"}` },
        /body/,
      ],
      ['no author', { authorId: '' }, /authorId/],
      ['a version below 1', { version: 0 }, /version/],
      [
        'a version above 1 without editedAt',
        { version: 2 },
        /without editedAt/,
      ],
      [
        'editedAt at version 1',
        { editedAt: '2026-11-15T11:00:00.000Z' },
        /at version 1/,
      ],
      [
        'editedAt before createdAt',
        { version: 2, editedAt: '2026-11-15T09:00:00.000Z' },
        /before createdAt/,
      ],
    ])('reports %s', (_, over, message) => {
      const a = announcement(over as never);
      table.announcements = [a];
      table.notificationBroadcasts = [broadcastFor(announcement())];
      table.notificationBroadcasts[0].courseId = a.courseId;
      table.notificationBroadcasts[0].dedupeKey = a.announcementId;
      table.notificationBroadcasts[0].occurredAt = a.createdAt;
      const { violations } = broken();

      expect(violations.map((v) => v.invariant)).toContain(
        'announcement-shape',
      );
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(message),
      );
      expect(
        violations.find((v) => v.invariant === 'announcement-shape')?.record,
      ).toEqual({ courseId: a.courseId, announcementId: a.announcementId });
    });
  });

  describe('announcement-has-broadcast', () => {
    const AT = '2026-11-15T10:00:00.000Z';
    const ID = `${new Date(AT)
      .getTime()
      .toString(16)
      .padStart(12, '0')
      .replace(/^(.{8})(.{4})$/, '$1-$2')}-7000-8000-000000000001`;
    const announcement: TableSnapshot['announcements'][number] = {
      courseId: 'c1',
      announcementId: ID,
      title: 'Welcome',
      body: '{"type":"doc","content":[{"type":"paragraph"}]}',
      authorId: 'instructor',
      createdAt: AT,
      version: 1,
    };
    const broadcast = (
      over: Partial<TableSnapshot['notificationBroadcasts'][number]> = {},
    ): TableSnapshot['notificationBroadcasts'][number] => ({
      id: 'b'.repeat(16),
      type: 'announcement.posted',
      courseId: 'c1',
      dedupeKey: ID,
      occurredAt: AT,
      status: 'done',
      completedAt: NOW,
      createdAt: AT,
      ...over,
    });

    it('passes an announcement with its broadcast', () => {
      table.announcements = [announcement];
      table.notificationBroadcasts = [broadcast()];
      expect(broken().invariants).toEqual([]);
    });

    it('reports an announcement whose broadcast was deleted', () => {
      table.announcements = [announcement];
      expectOnly('announcement-has-broadcast', /no announcement.posted/);
    });

    it.each([
      ['another dedupe key', { dedupeKey: 'other' }],
      ['another type', { type: 'review.received' }],
      ['another course', { courseId: 'c2' }],
    ])('reports a broadcast with %s', (_, over) => {
      table.announcements = [announcement];
      table.notificationBroadcasts = [broadcast(over)];
      expectOnly('announcement-has-broadcast', /no announcement.posted/);
    });

    it('reports a broadcast with another time', () => {
      table.announcements = [announcement];
      table.notificationBroadcasts = [
        broadcast({ occurredAt: '2026-11-15T10:00:01.000Z' }),
      ];
      expectOnly('announcement-has-broadcast', /occurredAt/);
    });

    it('does not report a broadcast whose announcement was deleted', () => {
      table.notificationBroadcasts = [broadcast()];
      expect(broken().invariants).toEqual([]);
    });
  });
});
