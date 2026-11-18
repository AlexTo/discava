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
  // Caption writes (a track added, a status change) are contentItem MODIFY
  // records, so the filter cannot tell them from other edits and lets them
  // through; the recalculation then ignores them because neither visibility
  // nor archivedAt changed (see progress-recalculation.test.ts).
  it('lets a caption write through, to be ignored by the recalculation', () => {
    expect(
      matchesProgressStreamFilters(record('MODIFY', 'NewImage', 'contentItem')),
    ).toBe(true);
  });

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
    ['a new category', record('INSERT', 'NewImage', 'category')],
    ['a category change', record('MODIFY', 'NewImage', 'category')],
    ['a new category claim', record('INSERT', 'NewImage', 'categoryClaim')],
    // The recalculation's own write when it issues a certificate.
    // A student's saved video position, written every few seconds.
    ['a new video position', record('INSERT', 'NewImage', 'videoPosition')],
    ['a saved video position', record('MODIFY', 'NewImage', 'videoPosition')],
    ['a new certificate', record('INSERT', 'NewImage', 'certificate')],
    // A submission's own change; its completion is what drives progress.
    ['a new submission', record('INSERT', 'NewImage', 'assignmentSubmission')],
    ['a resubmission', record('MODIFY', 'NewImage', 'assignmentSubmission')],
    // Reviews and the rating tally change no item, so no progress.
    ...['review', 'courseRating'].flatMap((entity) => [
      [`a new ${entity}`, record('INSERT', 'NewImage', entity)],
      [`a changed ${entity}`, record('MODIFY', 'NewImage', entity)],
      [`a removed ${entity}`, record('REMOVE', 'OldImage', entity)],
    ]),
    ['a record with no images', { eventName: 'MODIFY', dynamodb: {} }],
  ])('leaves out %s', (_, streamRecord) => {
    expect(matchesProgressStreamFilters(streamRecord)).toBe(false);
  });
});
