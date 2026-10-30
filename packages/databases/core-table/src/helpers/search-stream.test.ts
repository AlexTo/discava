/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  matchesSearchStreamFilters,
  SEARCH_ENTITIES,
  SEARCH_STREAM_FILTERS,
} from './search-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({ eventName, dynamodb: { [image]: { __edb_e__: { S: entity } } } });

describe('matchesSearchStreamFilters', () => {
  it.each(SEARCH_ENTITIES)('lets through a new %s', (entity) => {
    expect(
      matchesSearchStreamFilters(record('INSERT', 'NewImage', entity)),
    ).toBe(true);
  });

  it.each(SEARCH_ENTITIES)('lets through an edited %s', (entity) => {
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'NewImage', entity)),
    ).toBe(true);
  });

  it.each(SEARCH_ENTITIES)('lets through a removed %s', (entity) => {
    expect(
      matchesSearchStreamFilters(record('REMOVE', 'OldImage', entity)),
    ).toBe(true);
  });

  it.each([
    // The recalculation's and other pipelines' writes, which never change what
    // a search shows.
    ['a progress write', record('MODIFY', 'NewImage', 'progress')],
    ['an enrolment write', record('MODIFY', 'NewImage', 'enrolment')],
    [
      'an item completion write',
      record('INSERT', 'NewImage', 'itemCompletion'),
    ],
    // A removed record's new image is empty; its entity is in the old image,
    // which is the only one a REMOVE filter reads.
    [
      'a removed lesson read from the wrong image',
      {
        eventName: 'REMOVE',
        dynamodb: { NewImage: { __edb_e__: { S: 'lesson' } } },
      },
    ],
    ['a record with no images', { eventName: 'MODIFY', dynamodb: {} }],
  ])('leaves out %s', (_, streamRecord) => {
    expect(matchesSearchStreamFilters(streamRecord)).toBe(false);
  });
});

describe('SEARCH_STREAM_FILTERS', () => {
  it('covers each event name against the right image', () => {
    expect(SEARCH_STREAM_FILTERS).toEqual([
      { eventName: 'INSERT', image: 'NewImage', entities: SEARCH_ENTITIES },
      { eventName: 'MODIFY', image: 'NewImage', entities: SEARCH_ENTITIES },
      { eventName: 'REMOVE', image: 'OldImage', entities: SEARCH_ENTITIES },
    ]);
  });

  it('indexes the content types and users, not the recalculation types', () => {
    expect(SEARCH_ENTITIES).toEqual([
      'course',
      'module',
      'lesson',
      'contentItem',
      'user',
    ]);
    for (const entity of ['progress', 'enrolment', 'itemCompletion']) {
      expect(SEARCH_ENTITIES).not.toContain(entity);
    }
  });
});
