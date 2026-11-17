/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesNotificationStreamFilters } from './notification-stream.js';
import { matchesProgressStreamFilters } from './progress-stream.js';
import { matchesSearchStreamFilters } from './search-stream.js';

// Announcement writes add stream records; none may trigger progress, search
// or notification work (a post's notifications come from its broadcast).
const record = (eventName: string, image: 'NewImage' | 'OldImage') => ({
  eventName,
  dynamodb: { [image]: { __edb_e__: { S: 'announcement' } } },
});

describe('an announcement stream record', () => {
  it.each(['INSERT', 'MODIFY', 'REMOVE'])(
    'matches no filter on %s',
    (event) => {
      for (const image of ['NewImage', 'OldImage'] as const) {
        const r = record(event, image);
        expect(matchesProgressStreamFilters(r)).toBe(false);
        expect(matchesSearchStreamFilters(r)).toBe(false);
        expect(matchesNotificationStreamFilters(r)).toBe(false);
      }
    },
  );
});
