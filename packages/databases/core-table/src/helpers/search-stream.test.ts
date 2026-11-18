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
  // A landing-page edit (learningOutcomes, requirements) is a course MODIFY.
  // It matches, which is harmless: the document ignores those fields.
  it('matches a course edit that changes only the landing fields', () => {
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'NewImage', 'course')),
    ).toBe(true);
  });

  it.each([
    ['INSERT', 'NewImage'],
    ['MODIFY', 'NewImage'],
    ['REMOVE', 'OldImage'],
  ] as const)('ignores a %s of a course preview', (eventName, image) => {
    expect(
      matchesSearchStreamFilters(record(eventName, image, 'coursePreview')),
    ).toBe(false);
  });

  it('matches an inserted or modified course', () => {
    expect(
      matchesSearchStreamFilters(record('INSERT', 'NewImage', 'course')),
    ).toBe(true);
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'NewImage', 'course')),
    ).toBe(true);
  });

  it('matches an inserted or modified course rating, but not a removed one', () => {
    expect(
      matchesSearchStreamFilters(record('INSERT', 'NewImage', 'courseRating')),
    ).toBe(true);
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'NewImage', 'courseRating')),
    ).toBe(true);
    expect(
      matchesSearchStreamFilters(record('REMOVE', 'OldImage', 'courseRating')),
    ).toBe(false);
  });

  it('matches a removed course, by its old image', () => {
    expect(
      matchesSearchStreamFilters(record('REMOVE', 'OldImage', 'course')),
    ).toBe(true);
  });

  it('ignores a category or a category claim: documents hold only the categoryId', () => {
    for (const entity of ['category', 'categoryClaim']) {
      for (const eventName of ['INSERT', 'MODIFY']) {
        expect(
          matchesSearchStreamFilters(record(eventName, 'NewImage', entity)),
        ).toBe(false);
      }
      expect(
        matchesSearchStreamFilters(record('REMOVE', 'OldImage', entity)),
      ).toBe(false);
    }
  });

  it('ignores discussion posts and votes: the courses index does not hold them', () => {
    for (const entity of ['discussionPost', 'discussionVote']) {
      for (const eventName of ['INSERT', 'MODIFY']) {
        expect(
          matchesSearchStreamFilters(record(eventName, 'NewImage', entity)),
        ).toBe(false);
      }
      expect(
        matchesSearchStreamFilters(record('REMOVE', 'OldImage', entity)),
      ).toBe(false);
    }
  });

  it('ignores a review: the search document holds only the rating tally', () => {
    for (const eventName of ['INSERT', 'MODIFY']) {
      expect(
        matchesSearchStreamFilters(record(eventName, 'NewImage', 'review')),
      ).toBe(false);
    }
    expect(
      matchesSearchStreamFilters(record('REMOVE', 'OldImage', 'review')),
    ).toBe(false);
  });

  it('matches a course change that only touches catalogue fields', () => {
    const catalogueWrite = {
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: { __edb_e__: { S: 'course' } },
        NewImage: {
          __edb_e__: { S: 'course' },
          level: { S: 'beginner' },
        },
      },
    };
    expect(matchesSearchStreamFilters(catalogueWrite)).toBe(true);
  });

  it('ignores a curriculum change: the courses index does not depend on it', () => {
    for (const entity of ['module', 'lesson', 'contentItem']) {
      expect(
        matchesSearchStreamFilters(record('MODIFY', 'NewImage', entity)),
      ).toBe(false);
    }
  });

  it('ignores a caption write: a contentItem change, and no course document depends on it', () => {
    const captionWrite = {
      eventName: 'MODIFY',
      dynamodb: {
        OldImage: {
          __edb_e__: { S: 'contentItem' },
          captionsStatus: { S: 'pending' },
        },
        NewImage: {
          __edb_e__: { S: 'contentItem' },
          captionsStatus: { S: 'ready' },
        },
      },
    };
    expect(matchesSearchStreamFilters(captionWrite)).toBe(false);
  });

  it('ignores records that cannot affect search, like a new item completion', () => {
    expect(
      matchesSearchStreamFilters(
        record('INSERT', 'NewImage', 'itemCompletion'),
      ),
    ).toBe(false);
  });

  it('ignores a new certificate: the courses index does not depend on it', () => {
    expect(
      matchesSearchStreamFilters(record('INSERT', 'NewImage', 'certificate')),
    ).toBe(false);
  });

  it('ignores a MODIFY matched against the old image', () => {
    expect(
      matchesSearchStreamFilters(record('MODIFY', 'OldImage', 'course')),
    ).toBe(false);
  });
});
