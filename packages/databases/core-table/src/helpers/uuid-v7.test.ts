/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { uuidV7At } from '../test-support/uuid-v7.js';
import { idTimeWithin, uuidV7Time } from './uuid-v7.js';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const at = (ms: number) => uuidV7At(NOW.getTime() + ms);

describe('uuidV7Time', () => {
  it('reads the time part of a UUID v7', () => {
    expect(uuidV7Time(uuidV7At(NOW))).toBe(NOW.toISOString());
  });

  it.each([
    ['a v4 UUID', '3b241101-e2bb-4255-8caf-4136c566a962'],
    ['a bad variant', '01a1eb76-d255-7000-c000-000000000001'],
    ['a malformed string', 'nope'],
  ])('is undefined for %s', (_name, id) => {
    expect(uuidV7Time(id)).toBeUndefined();
  });
});

describe('idTimeWithin', () => {
  it('returns the time of an id inside the window, ends included', () => {
    expect(idTimeWithin(at(1000), NOW, 1000, 2000).time).toBe(
      new Date(NOW.getTime() + 1000).toISOString(),
    );
    expect(idTimeWithin(at(-2000), NOW, 1000, 2000).reason).toBeUndefined();
  });

  it('refuses an id past either end of the window', () => {
    expect(idTimeWithin(at(1001), NOW, 1000, 2000)).toEqual({
      reason: 'outside-window',
    });
    expect(idTimeWithin(at(-2001), NOW, 1000, 2000)).toEqual({
      reason: 'outside-window',
    });
  });

  it('refuses an id that is not a UUID v7', () => {
    expect(idTimeWithin('nope', NOW, 1000, 2000)).toEqual({
      reason: 'not-uuid-v7',
    });
  });
});
