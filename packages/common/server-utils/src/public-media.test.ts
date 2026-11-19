/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  courseImageKey,
  instructorPhotoKey,
  isCourseImageKey,
  isInstructorPhotoKey,
} from './public-media.js';

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

describe('isInstructorPhotoKey', () => {
  it('accepts a key instructorPhotoKey made for the instructor', () => {
    expect(isInstructorPhotoKey('i-1', instructorPhotoKey('i-1', NONCE))).toBe(
      true,
    );
  });

  it.each([
    ['another instructor’s', instructorPhotoKey('i-2', NONCE)],
    ['a course image', courseImageKey('i-1', NONCE)],
    ['a nested', `instructors/i-1/x/${NONCE}.jpg`],
    ['a made-up', 'instructors/i-1/../i-2/other.jpg'],
  ])('refuses %s key', (_, key) => {
    expect(isInstructorPhotoKey('i-1', key)).toBe(false);
  });
});
