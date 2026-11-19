/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { newPostId, relativeTime } from './discussion';

describe('newPostId', () => {
  it('is a UUID v7 whose time is now', () => {
    const before = Date.now();
    const id = newPostId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const time = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(Date.now());
  });

  it('is different each time', () => {
    expect(newPostId()).not.toBe(newPostId());
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-10T12:00:00.000Z');

  it('says just now under a minute', () => {
    expect(relativeTime('2026-10-10T11:59:30.000Z', now)).toBe('just now');
  });

  it('counts minutes, hours and days back', () => {
    expect(relativeTime('2026-10-10T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-10T09:00:00.000Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-07T12:00:00.000Z', now)).toBe('3 days ago');
  });
});
