/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { courseImageKey, isCourseImageKey } from './public-media.js';

const NONCE = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('isCourseImageKey', () => {
  it('accepts a key courseImageKey made for the course', () => {
    expect(
      isCourseImageKey('course-1', courseImageKey('course-1', NONCE)),
    ).toBe(true);
  });

  it.each([
    ['another course’s', courseImageKey('course-2', NONCE)],
    ['a lesson video’s', `courses/course-1/modules/m/lessons/l/${NONCE}.jpg`],
    ['a made-up', 'courses/course-1/image/../../other.jpg'],
  ])('refuses %s key', (_, key) => {
    expect(isCourseImageKey('course-1', key)).toBe(false);
  });
});
