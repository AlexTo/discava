/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { CreateCourseInputSchema } from './course.js';

describe('CreateCourseInputSchema', () => {
  it('trims the title', () => {
    expect(CreateCourseInputSchema.parse({ title: '  Maths  ' }).title).toBe(
      'Maths',
    );
  });

  it.each(['', '   ', '\t\n '])('refuses the blank title %j', (title) => {
    expect(CreateCourseInputSchema.safeParse({ title }).success).toBe(false);
  });
});
