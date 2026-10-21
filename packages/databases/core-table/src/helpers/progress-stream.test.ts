/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesProgressStreamFilters } from './progress-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({ eventName, dynamodb: { [image]: { __edb_e__: { S: entity } } } });

describe('matchesProgressStreamFilters', () => {
  it.each([
    ['a new item completion', record('INSERT', 'NewImage', 'itemCompletion')],
    ['an edited module', record('MODIFY', 'NewImage', 'module')],
    ['an edited lesson', record('MODIFY', 'NewImage', 'lesson')],
    ['an edited content item', record('MODIFY', 'NewImage', 'contentItem')],
    ['a removed lesson', record('REMOVE', 'OldImage', 'lesson')],
  ])('lets through %s', (_, streamRecord) => {
    expect(matchesProgressStreamFilters(streamRecord)).toBe(true);
  });

  it.each([
    // The recalculation's own writes, which would otherwise trigger it again.
    ['a progress write', record('MODIFY', 'NewImage', 'progress')],
    ['an enrolment write', record('MODIFY', 'NewImage', 'enrolment')],
    ['a removed completion', record('REMOVE', 'OldImage', 'itemCompletion')],
    ['a new lesson', record('INSERT', 'NewImage', 'lesson')],
    ['a course edit', record('MODIFY', 'NewImage', 'course')],
    ['a record with no images', { eventName: 'MODIFY', dynamodb: {} }],
  ])('leaves out %s', (_, streamRecord) => {
    expect(matchesProgressStreamFilters(streamRecord)).toBe(false);
  });
});
