/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import courses, { CourseDocumentSchema } from './courses.js';

// The courses mapping is applied to a live index with putMapping, which only
// accepts new properties. Changing one of these is a breaking change that
// needs #270's versioned index, so this pins them.
const properties = (
  courses as unknown as {
    mappings: { properties: Record<string, unknown> };
  }
).mappings.properties;

describe('courses mapping', () => {
  it('keeps every property of the first version unchanged', () => {
    expect(properties).toMatchObject({
      courseId: { type: 'keyword' },
      title: { type: 'text', analyzer: 'english' },
      description: { type: 'text', analyzer: 'english' },
      imageKey: { type: 'keyword', index: false },
      status: { type: 'keyword' },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },
    });
  });

  it('adds the catalogue fields as new properties', () => {
    expect(properties).toMatchObject({
      categoryId: { type: 'keyword' },
      tags: { type: 'keyword' },
      level: { type: 'keyword' },
      language: { type: 'keyword' },
      durationHours: { type: 'integer' },
    });
  });

  it('adds the rating fields as new numeric properties', () => {
    expect(properties).toMatchObject({
      ratingCount: { type: 'integer' },
      ratingAverage: { type: 'float' },
      ratingScore: { type: 'float' },
      ratingBoost: { type: 'float' },
    });
  });

  it('accepts a document with the rating fields and without them', () => {
    const doc = {
      courseId: 'c1',
      title: 'Intro',
      status: 'published',
      publishedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(CourseDocumentSchema.parse(doc)).toEqual(doc);
    const rated = {
      ...doc,
      ratingCount: 1,
      ratingAverage: 5,
      ratingScore: 3.75,
      ratingBoost: 1.025,
    };
    expect(CourseDocumentSchema.parse(rated)).toEqual(rated);
  });
});
