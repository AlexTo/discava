/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { getBreadcrumbs } from './portal-shell';

const matchAll = () => true;

describe('getBreadcrumbs', () => {
  it('links each crumb to its own path, labelled from overrides', () => {
    expect(
      getBreadcrumbs(
        matchAll,
        '/my-courses/course-1/quiz/new',
        'Home',
        {
          '/my-courses/course-1': 'Course One',
          '/my-courses/course-1/quiz': 'Quizzes',
          '/my-courses/course-1/quiz/new': 'New quiz',
        },
        { 'my-courses': 'My Courses' },
      ),
    ).toEqual([
      { href: '/', text: 'Home' },
      { href: '/my-courses', text: 'My Courses' },
      { href: '/my-courses/course-1', text: 'Course One' },
      { href: '/my-courses/course-1/quiz', text: 'Quizzes' },
      { href: '/my-courses/course-1/quiz/new', text: 'New quiz' },
    ]);
  });

  it('labels the root "Home"', () => {
    expect(getBreadcrumbs(matchAll, '/', 'Home', {})[0].text).toBe('Home');
  });

  it('gives a path without a page as text, and the page its own label', () => {
    const crumbs = getBreadcrumbs(
      (href) => href !== '/settings',
      '/settings/notifications',
      'Home',
      {},
      { settings: 'Settings', notifications: 'Notification settings' },
    );
    expect(crumbs).toEqual([
      { href: '/', text: 'Home' },
      { href: undefined, text: 'Settings' },
      { href: '/settings/notifications', text: 'Notification settings' },
    ]);
  });

  it('lets an override label replace an id segment', () => {
    const crumbs = getBreadcrumbs(
      matchAll,
      '/my-courses/0192-abc',
      'Home',
      { '/my-courses/0192-abc': 'Intro to Rust' },
      { 'my-courses': 'My Courses' },
    );
    expect(crumbs.map((c) => c.text)).toEqual([
      'Home',
      'My Courses',
      'Intro to Rust',
    ]);
  });

  it('never gives a crumb href="#"', () => {
    const crumbs = getBreadcrumbs(() => false, '/a/b', 'Home', {});
    expect(crumbs.some((c) => c.href === '#')).toBe(false);
  });

  it('labels a param segment neutrally when no title overrides it', () => {
    const crumbs = getBreadcrumbs(
      matchAll,
      '/my-courses/0192-abc',
      'Home',
      {},
      { 'my-courses': 'My Courses' },
      { '0192-abc': 'Course' },
    );
    expect(crumbs.map((c) => c.text)).toEqual(['Home', 'My Courses', 'Course']);
  });
});
