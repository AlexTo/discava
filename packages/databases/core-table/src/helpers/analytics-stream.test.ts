/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { matchesAnalyticsStreamFilters } from './analytics-stream.js';
import { matchesProgressStreamFilters } from './progress-stream.js';
import { matchesSearchStreamFilters } from './search-stream.js';

const record = (
  eventName: string,
  image: 'NewImage' | 'OldImage',
  entity: string,
) => ({ eventName, dynamodb: { [image]: { __edb_e__: { S: entity } } } });

describe('matchesAnalyticsStreamFilters', () => {
  it.each([
    ['a new enrolment', record('INSERT', 'NewImage', 'enrolment')],
    ['a changed enrolment', record('MODIFY', 'NewImage', 'enrolment')],
    ['a new progress record', record('INSERT', 'NewImage', 'progress')],
    ['a changed progress record', record('MODIFY', 'NewImage', 'progress')],
    ['a new quiz summary', record('INSERT', 'NewImage', 'quizSummary')],
    ['a changed quiz summary', record('MODIFY', 'NewImage', 'quizSummary')],
    ['a new item completion', record('INSERT', 'NewImage', 'itemCompletion')],
    ['a new quiz attempt', record('INSERT', 'NewImage', 'quizAttempt')],
    ['a removed enrolment', record('REMOVE', 'OldImage', 'enrolment')],
    ['a removed progress record', record('REMOVE', 'OldImage', 'progress')],
  ])('lets through %s', (_, streamRecord) => {
    expect(matchesAnalyticsStreamFilters(streamRecord)).toBe(true);
  });

  it.each([
    'courseStats',
    'periodStats',
    'lessonStats',
    'quizQuestionStats',
    'quizScoreStats',
    'analyticsMarker',
  ])('never lets through its own %s writes', (entity) => {
    for (const [eventName, image] of [
      ['INSERT', 'NewImage'],
      ['MODIFY', 'NewImage'],
      ['REMOVE', 'OldImage'],
    ] as const) {
      expect(
        matchesAnalyticsStreamFilters(record(eventName, image, entity)),
      ).toBe(false);
    }
  });

  it.each([
    [
      'a changed item completion',
      record('MODIFY', 'NewImage', 'itemCompletion'),
    ],
    ['a removed quiz attempt', record('REMOVE', 'OldImage', 'quizAttempt')],
    ['an edited lesson', record('MODIFY', 'NewImage', 'lesson')],
    ['a record with no entity', { eventName: 'INSERT', dynamodb: {} }],
  ])('ignores %s', (_, streamRecord) => {
    expect(matchesAnalyticsStreamFilters(streamRecord)).toBe(false);
  });

  it('does not widen progress recalculation or search indexing', () => {
    for (const entity of [
      'courseStats',
      'periodStats',
      'lessonStats',
      'quizQuestionStats',
      'quizScoreStats',
      'analyticsMarker',
    ]) {
      const written = record('INSERT', 'NewImage', entity);
      expect(matchesProgressStreamFilters(written)).toBe(false);
      expect(matchesSearchStreamFilters(written)).toBe(false);
    }
  });
});
