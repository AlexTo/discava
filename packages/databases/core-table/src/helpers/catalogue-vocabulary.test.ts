/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  categorySlug,
  normaliseCategoryName,
  normaliseTags,
} from './catalogue-vocabulary.js';
import { InvalidRequestError } from './errors.js';

describe('normaliseTags', () => {
  it('trims, collapses spaces and lower-cases', () => {
    expect(normaliseTags([' Data  Science '])).toEqual(['data science']);
  });

  it('collapses duplicates, keeping the first', () => {
    expect(normaliseTags(['SQL', 'sql ', 'Python', ' python'])).toEqual([
      'sql',
      'python',
    ]);
  });

  it('refuses an empty tag and one over 30 characters', () => {
    expect(() => normaliseTags(['  '])).toThrow(InvalidRequestError);
    expect(() => normaliseTags(['a'.repeat(31)])).toThrow(InvalidRequestError);
    expect(normaliseTags(['a'.repeat(30)])).toEqual(['a'.repeat(30)]);
  });

  it('refuses a ninth tag rather than truncating', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `tag${i}`);
    expect(normaliseTags(eight)).toHaveLength(8);
    expect(() => normaliseTags([...eight, 'tag8'])).toThrow(
      InvalidRequestError,
    );
  });

  it('counts a duplicate once towards the limit', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `tag${i}`);
    expect(normaliseTags([...eight, ' TAG0'])).toHaveLength(8);
  });
});

describe('normaliseCategoryName', () => {
  it('trims and collapses spaces, keeping case', () => {
    expect(normaliseCategoryName('  Data   Science ')).toBe('Data Science');
  });

  it('refuses an empty name and one over 60 characters', () => {
    expect(() => normaliseCategoryName('   ')).toThrow(InvalidRequestError);
    expect(() => normaliseCategoryName('a'.repeat(61))).toThrow(
      InvalidRequestError,
    );
    expect(normaliseCategoryName('a'.repeat(60))).toHaveLength(60);
  });
});

describe('categorySlug', () => {
  it('folds accents and turns symbols into single hyphens', () => {
    expect(categorySlug('Café & Bar')).toBe('cafe-bar');
    expect(categorySlug('  --Data___Science--  ')).toBe('data-science');
  });

  it('refuses a name with nothing URL-safe in it', () => {
    expect(() => categorySlug('???')).toThrow(InvalidRequestError);
  });
});
