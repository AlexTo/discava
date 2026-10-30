/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesSearchStreamFilters } from './search-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({
  eventName,
  dynamodb: { [image]: { __edb_e__: { S: entity } } },
});

describe('matchesSearchStreamFilters', () => {
  it('matches an inserted or modified course, module or lesson', () => {
    for (const entity of ['course', 'module', 'lesson']) {
      expect(
        matchesSearchStreamFilters(record('INSERT', 'NewImage', entity)),
      ).toBe(true);
      expect(
        matchesSearchStreamFilters(record('MODIFY', 'NewImage', entity)),
      ).toBe(true);
    }
  });

  it('matches a removed course, module or lesson, by its old image', () => {
    expect(
      matchesSearchStreamFilters(record('REMOVE', 'OldImage', 'lesson')),
    ).toBe(true);
  });

  it('ignores a content item change: neither index depends on it', () => {
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'NewImage', 'contentItem')),
    ).toBe(false);
  });

  it('ignores records that cannot affect search, like a new item completion', () => {
    expect(
      matchesSearchStreamFilters(
        record('INSERT', 'NewImage', 'itemCompletion'),
      ),
    ).toBe(false);
  });

  it('ignores a MODIFY matched against the old image', () => {
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'OldImage', 'lesson')),
    ).toBe(false);
  });
});
