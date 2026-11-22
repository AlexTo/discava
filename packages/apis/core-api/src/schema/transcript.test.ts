/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  TranscriptSearchInputSchema,
  TranscriptSearchOutputSchema,
} from './transcript.js';

const parse = (q: string) =>
  TranscriptSearchInputSchema.safeParse({ courseId: 'c1', q });

describe('TranscriptSearchInputSchema', () => {
  it('refuses a single character once trimmed', () => {
    expect(parse(' a ').success).toBe(false);
  });

  it('accepts two characters and trims them', () => {
    expect(parse(' ab ')).toMatchObject({ success: true, data: { q: 'ab' } });
  });

  it('refuses 201 characters and accepts 200', () => {
    expect(parse('a'.repeat(201)).success).toBe(false);
    expect(parse('a'.repeat(200)).success).toBe(true);
  });

  it('refuses an empty course id and a one-character language', () => {
    expect(
      TranscriptSearchInputSchema.safeParse({ courseId: '', q: 'ab' }).success,
    ).toBe(false);
    expect(
      TranscriptSearchInputSchema.safeParse({
        courseId: 'c1',
        q: 'ab',
        language: 'e',
      }).success,
    ).toBe(false);
  });
});

describe('TranscriptSearchOutputSchema', () => {
  const item = {
    moduleId: 'm',
    moduleTitle: 'M',
    lessonId: 'l',
    lessonTitle: 'L',
    contentItemId: 'i',
    itemTitle: 'I',
    startSeconds: 0,
    language: 'en',
    snippet: [{ text: 'hi', match: false }],
  };

  it('accepts 20 items and refuses 21', () => {
    const output = (n: number) => ({
      items: Array.from({ length: n }, () => item),
      hasMore: false,
    });
    expect(TranscriptSearchOutputSchema.safeParse(output(20)).success).toBe(
      true,
    );
    expect(TranscriptSearchOutputSchema.safeParse(output(21)).success).toBe(
      false,
    );
  });

  it('refuses a fractional or negative start', () => {
    for (const startSeconds of [1.5, -1]) {
      expect(
        TranscriptSearchOutputSchema.safeParse({
          items: [{ ...item, startSeconds }],
          hasMore: false,
        }).success,
      ).toBe(false);
    }
  });
});
