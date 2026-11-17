/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesNotificationStreamFilters } from './notification-stream.js';
import { matchesProgressStreamFilters } from './progress-stream.js';
import { matchesSearchStreamFilters } from './search-stream.js';

const record = (
  eventName: string,
  entity: string,
  image: 'NewImage' | 'OldImage' = 'NewImage',
) => ({
  eventName,
  dynamodb: { [image]: { __edb_e__: { S: entity } } },
});

const NEW_ENTITIES = [
  'notification',
  'notificationState',
  'notificationPreference',
  'notificationBroadcast',
];

describe('matchesNotificationStreamFilters', () => {
  it.each(['notification', 'notificationBroadcast'])(
    'matches an INSERT of %s',
    (entity) => {
      expect(matchesNotificationStreamFilters(record('INSERT', entity))).toBe(
        true,
      );
    },
  );

  it('ignores a MODIFY of a notification, like an email state patch', () => {
    expect(
      matchesNotificationStreamFilters(record('MODIFY', 'notification')),
    ).toBe(false);
  });

  it('ignores a REMOVE and an INSERT matched against the old image', () => {
    expect(
      matchesNotificationStreamFilters(
        record('REMOVE', 'notification', 'OldImage'),
      ),
    ).toBe(false);
    expect(
      matchesNotificationStreamFilters(
        record('INSERT', 'notification', 'OldImage'),
      ),
    ).toBe(false);
  });

  it.each([
    'course',
    'enrolment',
    'itemCompletion',
    'notificationState',
    'notificationPreference',
  ])('ignores an INSERT of %s', (entity) => {
    expect(matchesNotificationStreamFilters(record('INSERT', entity))).toBe(
      false,
    );
  });
});

describe('the other stream features', () => {
  it.each(NEW_ENTITIES)('do not match %s records', (entity) => {
    for (const eventName of ['INSERT', 'MODIFY', 'REMOVE']) {
      for (const image of ['NewImage', 'OldImage'] as const) {
        const r = record(eventName, entity, image);
        expect(matchesProgressStreamFilters(r)).toBe(false);
        expect(matchesSearchStreamFilters(r)).toBe(false);
      }
    }
  });
});
