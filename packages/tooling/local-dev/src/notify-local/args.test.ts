/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cannedParams, parseNotifyArgs } from './args.js';

const now = () => new Date('2026-11-17T01:02:03.456Z');

describe('parseNotifyArgs', () => {
  it('publishes to a user with canned params, a fresh key and the time now', () => {
    expect(
      parseNotifyArgs(
        ['--user', 'u1', '--type', 'review.received'],
        now,
        () => 'k1',
      ),
    ).toEqual({
      userId: 'u1',
      type: 'review.received',
      params: {
        courseId: 'sample-courseId',
        courseTitle: 'sample-courseTitle',
        rating: '5',
      },
      dedupeKey: 'notify-local-k1',
      occurredAt: '2026-11-17T01:02:03.456Z',
    });
  });

  it('overrides params, takes a key, and skips a passed-through separator', () => {
    expect(
      parseNotifyArgs(
        [
          '--',
          '--user',
          'u1',
          '--type',
          'review.received',
          '--param',
          'rating=3',
          '--param',
          'courseTitle=A=B',
          '--key',
          'mine',
        ],
        now,
      ),
    ).toMatchObject({
      params: { rating: '3', courseTitle: 'A=B', courseId: 'sample-courseId' },
      dedupeKey: 'mine',
    });
  });

  it('broadcasts to a course', () => {
    const request = parseNotifyArgs(
      ['--course', 'c1', '--type', 'announcement.posted'],
      now,
    );
    expect(request).toMatchObject({ courseId: 'c1' });
    expect(request).not.toHaveProperty('userId');
  });

  it.each([
    [[]],
    [['--type', 'review.received']],
    [['--user', 'u1']],
    [['--user', 'u1', '--course', 'c1', '--type', 'review.received']],
    [['--user', 'u1', '--type', 'review.received', '--param', 'novalue']],
    [['--user', 'u1', '--type', 'nope.nope']],
    [['--user', 'u1', '--type', 'review.received', '--bogus']],
  ])('refuses %j', (args) => {
    expect(() => parseNotifyArgs(args, now)).toThrow();
  });
});

describe('cannedParams', () => {
  it('has a value for every param of every type', () => {
    for (const type of [
      'assignment.returned',
      'announcement.posted',
      'discussion.reply',
      'review.received',
    ]) {
      expect(Object.values(cannedParams(type)).every(Boolean)).toBe(true);
    }
  });
});
