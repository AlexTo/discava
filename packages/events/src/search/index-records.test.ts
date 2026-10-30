/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { searchTargetsFromRecords } from './index-records.js';

// The handler's parser (DynamoDBStreamSchema) turns each DynamoDB attribute
// into its plain value before the indexer reads it, so a record's image is a
// map of attribute name to plain value (not a DynamoDB attribute map).
const image = (entity: string, fields: Record<string, string> = {}) => ({
  __edb_e__: entity,
  ...fields,
});

const record = (
  eventName: string,
  which: 'NewImage' | 'OldImage',
  entity: string,
  fields: Record<string, string> = {},
) => ({ eventName, dynamodb: { [which]: image(entity, fields) } });

describe('searchTargetsFromRecords', () => {
  it('targets the course from a course record', () => {
    const { courseIds, userIds } = searchTargetsFromRecords([
      record('INSERT', 'NewImage', 'course', { courseId: 'c1' }),
    ]);
    expect(courseIds).toEqual(new Set(['c1']));
    expect(userIds).toEqual(new Set());
  });

  it('targets the course from a module, lesson or content item record', () => {
    const { courseIds } = searchTargetsFromRecords([
      record('MODIFY', 'NewImage', 'module', { courseId: 'c1' }),
      record('MODIFY', 'NewImage', 'lesson', { courseId: 'c2' }),
      record('REMOVE', 'OldImage', 'contentItem', { courseId: 'c3' }),
    ]);
    expect(courseIds).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('targets the user from a user record', () => {
    const { courseIds, userIds } = searchTargetsFromRecords([
      record('INSERT', 'NewImage', 'user', { userId: 'u1' }),
      record('REMOVE', 'OldImage', 'user', { userId: 'u2' }),
    ]);
    expect(courseIds).toEqual(new Set());
    expect(userIds).toEqual(new Set(['u1', 'u2']));
  });

  it('deduplicates repeated courses and users', () => {
    const { courseIds, userIds } = searchTargetsFromRecords([
      record('MODIFY', 'NewImage', 'lesson', { courseId: 'c1' }),
      record('MODIFY', 'NewImage', 'contentItem', { courseId: 'c1' }),
      record('MODIFY', 'NewImage', 'user', { userId: 'u1' }),
      record('MODIFY', 'NewImage', 'user', { userId: 'u1' }),
    ]);
    expect(courseIds).toEqual(new Set(['c1']));
    expect(userIds).toEqual(new Set(['u1']));
  });

  it('ignores records that reach the indexer by mistake', () => {
    const { courseIds, userIds } = searchTargetsFromRecords([
      record('MODIFY', 'NewImage', 'progress', { courseId: 'c1' }),
      record('MODIFY', 'NewImage', 'enrolment'),
      { eventName: 'MODIFY', dynamodb: {} },
    ]);
    expect(courseIds).toEqual(new Set());
    expect(userIds).toEqual(new Set());
  });
});
