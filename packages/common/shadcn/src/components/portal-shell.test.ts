/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { getBreadcrumbs } from './portal-shell';

const matchAll = (() => true) as unknown as Parameters<
  typeof getBreadcrumbs
>[0];

describe('getBreadcrumbs', () => {
  it('links each crumb to its own path, labelled from overrides', () => {
    expect(
      getBreadcrumbs(
        matchAll,
        '/my-courses/course-1/quiz/new',
        '/',
        {
          '/my-courses/course-1': 'Course One',
          '/my-courses/course-1/quiz': 'Quizzes',
          '/my-courses/course-1/quiz/new': 'New quiz',
        },
        { 'my-courses': 'My Courses' },
      ),
    ).toEqual([
      { href: '/', text: '/' },
      { href: '/my-courses', text: 'My Courses' },
      { href: '/my-courses/course-1', text: 'Course One' },
      { href: '/my-courses/course-1/quiz', text: 'Quizzes' },
      { href: '/my-courses/course-1/quiz/new', text: 'New quiz' },
    ]);
  });
});
