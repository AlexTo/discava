/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  BRAND_STREAM_FILTERS,
  matchesBrandStreamFilters,
} from './brand-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({
  eventName,
  dynamodb: { [image]: { __edb_e__: { S: entity } } },
});

describe('matchesBrandStreamFilters', () => {
  it.each(['INSERT', 'MODIFY'])('matches a %s of the brand', (event) => {
    expect(
      matchesBrandStreamFilters(record(event, 'NewImage', 'platformBrand')),
    ).toBe(true);
  });

  it('does not match a removal, which nothing does to the brand', () => {
    expect(
      matchesBrandStreamFilters(record('REMOVE', 'OldImage', 'platformBrand')),
    ).toBe(false);
  });

  it.each(['course', 'order', 'paymentConnection', 'user', 'category'])(
    'does not match a %s',
    (entity) => {
      for (const event of ['INSERT', 'MODIFY']) {
        expect(
          matchesBrandStreamFilters(record(event, 'NewImage', entity)),
        ).toBe(false);
      }
    },
  );

  it('names only the platformBrand entity', () => {
    expect(BRAND_STREAM_FILTERS.flatMap((filter) => filter.entities)).toEqual([
      'platformBrand',
      'platformBrand',
    ]);
  });
});
