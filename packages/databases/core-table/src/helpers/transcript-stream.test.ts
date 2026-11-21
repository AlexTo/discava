/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesTranscriptStreamFilters } from './transcript-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({
  eventName,
  dynamodb: { [image]: { __edb_e__: { S: entity } } },
});

describe('matchesTranscriptStreamFilters', () => {
  it.each([
    ['INSERT', 'NewImage'],
    ['MODIFY', 'NewImage'],
    ['REMOVE', 'OldImage'],
  ] as const)('matches a %s of a contentItem', (eventName, image) => {
    expect(
      matchesTranscriptStreamFilters(record(eventName, image, 'contentItem')),
    ).toBe(true);
  });

  it.each([
    ['INSERT', 'NewImage'],
    ['MODIFY', 'NewImage'],
    ['REMOVE', 'OldImage'],
  ] as const)(
    'ignores a %s of a lesson, module, course, enrolment or itemCompletion',
    (eventName, image) => {
      for (const entity of [
        'lesson',
        'module',
        'course',
        'enrolment',
        'itemCompletion',
      ]) {
        expect(
          matchesTranscriptStreamFilters(record(eventName, image, entity)),
        ).toBe(false);
      }
    },
  );

  it('reads a MODIFY through its new image and a REMOVE through its old one', () => {
    expect(
      matchesTranscriptStreamFilters(
        record('MODIFY', 'OldImage', 'contentItem'),
      ),
    ).toBe(false);
    expect(
      matchesTranscriptStreamFilters(
        record('REMOVE', 'NewImage', 'contentItem'),
      ),
    ).toBe(false);
  });
});
