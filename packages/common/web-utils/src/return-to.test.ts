/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it.each([
    ['/courses/course-1', '/courses/course-1'],
    [
      '/my-courses/c-1?tab=archived#module-2',
      '/my-courses/c-1?tab=archived#module-2',
    ],
    ['/', '/'],
    ['/a/../b', '/b'],
  ])('keeps the path %s on this site', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });

  it.each([
    ['another origin', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example/phish'],
    ['a backslash that browsers read as //', '/\\evil.example'],
    ['a scheme', 'javascript:alert(1)'],
    ['a relative path', 'courses/course-1'],
    ['the sign-in page', '/signin?redirect=/x'],
    ['an empty string', ''],
    ['a non-string', { path: '/x' }],
    ['nothing', undefined],
  ])('refuses %s', (_, value) => {
    expect(safeReturnTo(value)).toBeUndefined();
  });
});
