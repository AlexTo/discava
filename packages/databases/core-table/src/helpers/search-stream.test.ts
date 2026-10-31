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
  it('matches an inserted or modified course', () => {
    expect(
      matchesSearchStreamFilters(record('INSERT', 'NewImage', 'course')),
    ).toBe(true);
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'NewImage', 'course')),
    ).toBe(true);
  });

  it('matches a removed course, by its old image', () => {
    expect(
      matchesSearchStreamFilters(record('REMOVE', 'OldImage', 'course')),
    ).toBe(true);
  });

  it('ignores a curriculum change: the courses index does not depend on it', () => {
    for (const entity of ['module', 'lesson', 'contentItem']) {
      expect(
        matchesSearchStreamFilters(record('MODIFY', 'NewImage', entity)),
      ).toBe(false);
    }
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
      matchesSearchStreamFilters(record('MODIFY', 'OldImage', 'course')),
    ).toBe(false);
  });
});
