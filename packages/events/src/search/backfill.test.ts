/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import { backfillTargetsFromItems } from './backfill.js';

// A core-table item as a scan returns it, with only the fields the backfill
// reads.
const item = (
  entity: string,
  fields: Record<string, string> = {},
): Record<string, AttributeValue> => ({
  __edb_e__: { S: entity },
  ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { S: v }])),
});

describe('backfillTargetsFromItems', () => {
  it('collects the course id from a course item', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([
      item('course', { courseId: 'c1' }),
    ]);
    expect(courseIds).toEqual(['c1']);
    expect(userIds).toEqual([]);
  });

  it('collects the user id from a user item', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([
      item('user', { userId: 'u1' }),
    ]);
    expect(courseIds).toEqual([]);
    expect(userIds).toEqual(['u1']);
  });

  it('mixes courses and users, preserving scan order', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([
      item('course', { courseId: 'c1' }),
      item('user', { userId: 'u1' }),
      item('course', { courseId: 'c2' }),
      item('user', { userId: 'u2' }),
    ]);
    expect(courseIds).toEqual(['c1', 'c2']);
    expect(userIds).toEqual(['u1', 'u2']);
  });

  it('ignores the content types the reindex functions take by course id', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([
      item('module', { courseId: 'c1' }),
      item('lesson', { courseId: 'c1' }),
      item('contentItem', { courseId: 'c1' }),
      item('progress', { courseId: 'c1' }),
    ]);
    expect(courseIds).toEqual([]);
    expect(userIds).toEqual([]);
  });

  it('ignores items whose entity id is missing', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([
      item('course'),
      item('user'),
    ]);
    expect(courseIds).toEqual([]);
    expect(userIds).toEqual([]);
  });

  it('de-duplicates ids, keeping first-seen order', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([
      item('course', { courseId: 'c1' }),
      item('course', { courseId: 'c1' }),
      item('user', { userId: 'u1' }),
      item('user', { userId: 'u1' }),
    ]);
    expect(courseIds).toEqual(['c1']);
    expect(userIds).toEqual(['u1']);
  });

  it('handles an empty scan', () => {
    const { courseIds, userIds } = backfillTargetsFromItems([]);
    expect(courseIds).toEqual([]);
    expect(userIds).toEqual([]);
  });
});
