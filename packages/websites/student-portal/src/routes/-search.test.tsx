/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { renderWithCoreApi } from '../test/render-with-core-api';
import { matchesQuery } from './search';

const published = (courseId: string, title: string, description?: string) => ({
  courseId,
  title,
  description,
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const courses = [
  published('python', 'Python for Beginners', 'Variables, decisions and loops'),
  published('linalg', 'Linear Algebra', 'Vectors and matrices'),
  published('cloud', 'Cloud Computing Fundamentals'),
];

const search = (query: string) =>
  renderWithCoreApi(null, {
    routeTree,
    path: query ? `/search?query=${encodeURIComponent(query)}` : '/search',
    signedIn: false,
    handlers: { 'course.publicList': () => ({ items: courses }) },
  });

describe('matchesQuery', () => {
  it.each([
    ['python', true],
    ['PYTHON beginners', true],
    ['loops python', true],
    ['decisions', true],
    ['python matrices', false],
    ['java', false],
  ])('%s → %s', (query, matches) => {
    expect(matchesQuery(courses[0], query)).toBe(matches);
  });

  it('copes with a course that has no description', () => {
    expect(matchesQuery(courses[2], 'cloud')).toBe(true);
  });
});

describe('/search', () => {
  it('lists the matching courses, linking to each', async () => {
    search('linear');

    expect(
      await screen.findByRole('heading', { name: 'Results for “linear”' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: /Linear Algebra/ }),
    ).toHaveAttribute('href', '/learn/linalg');
    expect(screen.getByText('1 course')).toBeInTheDocument();
    expect(screen.queryByText('Python for Beginners')).toBeNull();
  });

  it('says when nothing matches', async () => {
    search('quantum');
    expect(
      await screen.findByText(/No courses match your search/),
    ).toBeInTheDocument();
  });

  it('asks what to search for when there is no query, without calling the API', async () => {
    const { calls } = search('');
    expect(
      await screen.findByRole('heading', { name: 'Search for a course' }),
    ).toBeInTheDocument();
    expect(calls.map(({ path }) => path)).not.toContain('course.publicList');
  });

  it('shows the query in the top bar', async () => {
    search('linear');
    expect(
      await screen.findByRole('searchbox', { name: 'Search courses' }),
    ).toHaveValue('linear');
  });
});
