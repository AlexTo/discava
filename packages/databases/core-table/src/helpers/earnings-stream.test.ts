/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesEarningsStreamFilters } from './earnings-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({ eventName, dynamodb: { [image]: { __edb_e__: { S: entity } } } });

describe('matchesEarningsStreamFilters', () => {
  it.each([
    ['a new order', record('INSERT', 'NewImage', 'order')],
    ['a changed order', record('MODIFY', 'NewImage', 'order')],
  ])('lets through %s', (_, streamRecord) => {
    expect(matchesEarningsStreamFilters(streamRecord)).toBe(true);
  });

  it.each([
    ['a removed order', record('REMOVE', 'OldImage', 'order')],
    [
      'a changed order read from its old image',
      record('MODIFY', 'OldImage', 'order'),
    ],
    ['a changed enrolment', record('MODIFY', 'NewImage', 'enrolment')],
    [
      'a changed payment connection',
      record('MODIFY', 'NewImage', 'paymentConnection'),
    ],
    ['a record with no entity', { eventName: 'INSERT', dynamodb: {} }],
  ])('ignores %s', (_, streamRecord) => {
    expect(matchesEarningsStreamFilters(streamRecord)).toBe(false);
  });

  it.each([
    'earningEntry',
    'earningDay',
    'earningOrder',
    'payout',
    'payoutAccount',
  ])('never lets through its own %s writes', (entity) => {
    for (const [eventName, image] of [
      ['INSERT', 'NewImage'],
      ['MODIFY', 'NewImage'],
      ['REMOVE', 'OldImage'],
    ] as const) {
      expect(
        matchesEarningsStreamFilters(record(eventName, image, entity)),
      ).toBe(false);
    }
  });
});
