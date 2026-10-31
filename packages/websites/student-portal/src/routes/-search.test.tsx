/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { ApiError, renderWithCoreApi } from '../test/render-with-core-api';

const hit = (courseId: string, title: string, description?: string) => ({
  courseId,
  title,
  description,
});

const search = (
  query: string,
  handler: (input: unknown) => unknown = () => ({
    items: [hit('linalg', 'Linear Algebra', 'Vectors and matrices')],
    cursor: null,
  }),
) =>
  renderWithCoreApi(null, {
    routeTree,
    path: query ? `/search?query=${encodeURIComponent(query)}` : '/search',
    signedIn: false,
    handlers: { 'course.publicSearch': handler },
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
  });

  it('says when nothing matches', async () => {
    search('quantum', () => ({ items: [], cursor: null }));
    expect(
      await screen.findByText(/No courses match your search/),
    ).toBeInTheDocument();
  });

  it('asks what to search for when there is no query, without calling the API', async () => {
    const { calls } = search('');
    expect(
      await screen.findByRole('heading', { name: 'Search for a course' }),
    ).toBeInTheDocument();
    expect(calls.map(({ path }) => path)).not.toContain('course.publicSearch');
  });

  it('shows the query in the top bar', async () => {
    search('linear');
    expect(
      await screen.findByRole('searchbox', { name: 'Search courses' }),
    ).toHaveValue('linear');
  });

  it('loads another page of results by offset, not a DynamoDB cursor', async () => {
    const { calls, user } = search('linear', (input) => {
      const { cursor } = input as { cursor?: number };
      return cursor === 1
        ? { items: [hit('calc', 'Calculus')], cursor: null }
        : { items: [hit('linalg', 'Linear Algebra')], cursor: 1 };
    });

    await screen.findByText('Load more results');
    await user.click(screen.getByRole('button', { name: 'Load more results' }));

    expect(await screen.findByText('Calculus')).toBeInTheDocument();
    expect(calls.map(({ input }) => input)).toMatchObject([
      { q: 'linear' },
      { q: 'linear', cursor: 1 },
    ]);
  });

  it('shows a waiting state and retries once while the collection cold-starts', async () => {
    let attempts = 0;
    search('linear', () => {
      attempts++;
      if (attempts === 1) {
        throw new ApiError(
          'TIMEOUT',
          'Search is starting up. Try again in a few seconds.',
        );
      }
      return { items: [hit('linalg', 'Linear Algebra')], cursor: null };
    });

    await waitFor(() => expect(attempts).toBeGreaterThan(1), {
      timeout: 10_000,
    });
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();
  });
});
