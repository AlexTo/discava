/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { toCourseDocument } from './course-document.js';

describe('toCourseDocument', () => {
  // A course MODIFY that only flips the certificates setting still reaches
  // the indexer, which must then write the same document it already has.
  it('is unchanged by the course’s certificatesEnabled setting', () => {
    const course = {
      courseId: 'course-1',
      title: 'Intro',
      description: 'About',
      publishedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    };

    expect(toCourseDocument({ ...course, certificatesEnabled: false })).toEqual(
      toCourseDocument({ ...course, certificatesEnabled: true }),
    );
  });

  const base = {
    courseId: 'course-1',
    title: 'Intro',
    publishedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  };

  it('carries the catalogue fields', () => {
    expect(
      toCourseDocument({
        ...base,
        categoryId: 'cat-1',
        tags: ['sql', 'data'],
        level: 'beginner',
        language: 'en',
        durationHours: 12,
      }),
    ).toMatchObject({
      categoryId: 'cat-1',
      tags: ['sql', 'data'],
      level: 'beginner',
      language: 'en',
      durationHours: 12,
    });
  });

  it('leaves the catalogue fields out for a course without them', () => {
    const doc = toCourseDocument(base);
    for (const field of [
      'categoryId',
      'tags',
      'level',
      'language',
      'durationHours',
    ]) {
      expect(doc[field as keyof typeof doc]).toBeUndefined();
    }
  });

  it('carries the rating fields of a rated course', () => {
    // One 5-star rating: average 5, score (5 + 5 x 3.5) / 6 = 3.75.
    const doc = toCourseDocument(base, { stars5: 1 });
    expect(doc.ratingCount).toBe(1);
    expect(doc.ratingAverage).toBe(5);
    expect(doc.ratingScore).toBeCloseTo(3.75);
    expect(doc.ratingBoost).toBeCloseTo(1.025);
  });

  it('rounds the average to one decimal', () => {
    // (4 + 4 + 5) / 3 = 4.333...
    expect(toCourseDocument(base, { stars4: 2, stars5: 1 }).ratingAverage).toBe(
      4.3,
    );
  });

  it('has only a boost of 1 for an unrated course', () => {
    for (const rating of [undefined, {}, { stars3: 0 }]) {
      const doc = toCourseDocument(base, rating);
      expect(doc.ratingBoost).toBe(1);
      expect(doc.ratingCount).toBeUndefined();
      expect(doc.ratingAverage).toBeUndefined();
      expect(doc.ratingScore).toBeUndefined();
    }
  });
});
