/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import courses from './courses.js';

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
});
