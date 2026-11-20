/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { parseCourseIds } from './args.js';

describe('parseCourseIds', () => {
  it('takes each argument as a course id, once', () => {
    expect(parseCourseIds(['a1', 'b-2', 'a1'])).toEqual(['a1', 'b-2']);
  });

  it('skips the separator nx passes through', () => {
    expect(parseCourseIds(['--', 'c1'])).toEqual(['c1']);
  });

  it('asks for a course id when there is none', () => {
    expect(() => parseCourseIds([])).toThrow(/Usage: rebuild-analytics/);
    expect(() => parseCourseIds(['--'])).toThrow(/Usage/);
  });

  it('refuses something that is not an id', () => {
    expect(() => parseCourseIds(['ok', 'bad id'])).toThrow(/"bad id"/);
    expect(() => parseCourseIds(['../x'])).toThrow(/not a course id/);
  });
});
