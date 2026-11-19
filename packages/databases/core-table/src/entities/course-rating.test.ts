/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createCourseRatingEntity } from './course-rating.js';

let courseRating: Awaited<ReturnType<typeof createCourseRatingEntity>>;
beforeAll(async () => {
  courseRating = await createCourseRatingEntity();
});

describe('courseRating', () => {
  it('is created with just a course: an absent counter reads as 0', () => {
    const { Item } = courseRating.create({ courseId: 'course-1' }).params();

    expect(Item).toMatchObject({ courseId: 'course-1' });
    expect(Item).not.toHaveProperty('stars1');
  });

  it('is refused without a course', () => {
    expect(() => courseRating.create({} as never).params()).toThrow();
  });

  it('has one record per course, at a constant sort key', () => {
    const key = (courseId: string) =>
      courseRating.get({ courseId }).params() as {
        Key: Record<string, string>;
      };

    expect(key('course-1').Key.sk).toEqual(key('course-2').Key.sk);
    expect(key('course-1').Key.pk).not.toEqual(key('course-2').Key.pk);
  });
});
