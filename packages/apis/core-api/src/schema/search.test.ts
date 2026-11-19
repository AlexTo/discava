/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { SuggestCoursesInputSchema } from './search.js';

describe('SuggestCoursesInputSchema', () => {
  it('refuses text under 3 characters once trimmed', () => {
    expect(SuggestCoursesInputSchema.safeParse({ q: '  ab  ' }).success).toBe(
      false,
    );
  });

  it('accepts 3 characters and trims them', () => {
    expect(SuggestCoursesInputSchema.parse({ q: ' abc ' })).toEqual({
      q: 'abc',
    });
  });

  it('refuses more than 200 characters', () => {
    expect(
      SuggestCoursesInputSchema.safeParse({ q: 'a'.repeat(201) }).success,
    ).toBe(false);
    expect(
      SuggestCoursesInputSchema.safeParse({ q: 'a'.repeat(200) }).success,
    ).toBe(true);
  });
});
