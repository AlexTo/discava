/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { ApiError, renderWithCoreApi } from '../../test/render-with-core-api';

const hit = (courseId: string, title: string, description?: string) => ({
  courseId,
  title,
  description,
  tags: [],
});

const facets = {
  categories: [],
  tags: [],
  levels: [],
  languages: [],
  durationBands: [],
};

const search = (
  query: string,
  handler: (input: unknown) => unknown = () => ({
    items: [hit('linalg', 'Linear Algebra', 'Vectors and matrices')],
    cursor: null,
    facets,
  }),
) =>
  renderWithCoreApi(null, {
    routeTree,
    path: query ? `/search?query=${encodeURIComponent(query)}` : '/search',
    signedIn: false,
    handlers: {
      'course.publicSearch': (input) => {
        const result = handler(input) as Record<string, unknown>;
        return { facets, ...result };
      },
      'category.list': () => [],
    },
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

  it('shows each course as the catalogue’s card, with its description and a link', async () => {
    search('linear');

    expect(await screen.findByText('Vectors and matrices')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Preview Linear Algebra' }),
    ).toHaveAttribute('href', '/learn/linalg');
    expect(screen.getByText('Learn more')).toBeInTheDocument();
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
    expect(
      calls
        .filter(({ path }) => path === 'course.publicSearch')
        .map(({ input }) => input),
    ).toMatchObject([{ q: 'linear' }, { q: 'linear', cursor: 1 }]);
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

  describe('filters', () => {
    const facetsWithCounts = {
      categories: [
        { id: 'cat-1', name: 'Science', slug: 'science', count: 3 },
        { id: 'cat-2', name: 'Business', slug: 'business', count: 1 },
      ],
      tags: [{ value: 'sql', count: 2 }],
      levels: [
        { value: 'beginner', count: 2 },
        { value: 'advanced', count: 1 },
      ],
      languages: [{ value: 'en', count: 3 }],
      durationBands: [{ value: 'lt2', count: 1 }],
    };

    const filtered = (path: string) =>
      renderWithCoreApi(null, {
        routeTree,
        path,
        signedIn: false,
        handlers: {
          'course.publicSearch': () => ({
            items: [hit('linalg', 'Linear Algebra')],
            cursor: null,
            facets: facetsWithCounts,
          }),
          'category.list': () => [
            { id: 'cat-1', name: 'Science', slug: 'science', courseCount: 3 },
          ],
        },
      });

    it('shows each group with the count of every value', async () => {
      filtered('/search?query=linear');

      expect(
        await screen.findByRole('checkbox', { name: /Beginner/ }),
      ).toBeInTheDocument();
      expect(screen.getByText('Level')).toBeInTheDocument();
      expect(screen.getByText('Category')).toBeInTheDocument();
      expect(screen.getByText('Language')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
      expect(screen.getByText('Tags')).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'Science (3)' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'Under 2 hours (1)' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'English (3)' }),
      ).toBeInTheDocument();
    });

    it('puts a selected value in the address and the request, and clears it', async () => {
      const { router, calls, user } = filtered('/search?query=linear');

      await user.click(
        await screen.findByRole('checkbox', { name: 'Beginner (2)' }),
      );

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          query: 'linear',
          levels: ['beginner'],
        }),
      );
      await waitFor(() =>
        expect(
          calls
            .filter(({ path }) => path === 'course.publicSearch')
            .map(({ input }) => input),
        ).toContainEqual(
          expect.objectContaining({ q: 'linear', levels: ['beginner'] }),
        ),
      );

      await user.click(
        await screen.findByRole('button', { name: 'Clear filters' }),
      );
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ query: 'linear' }),
      );
    });

    it('restores the filters from the address', async () => {
      const { calls } = filtered(
        '/search?query=linear&levels=%5B%22advanced%22%5D&durations=%5B%22lt2%22%5D&category=science',
      );

      expect(
        await screen.findByRole('checkbox', { name: 'Advanced (1)' }),
      ).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: 'Under 2 hours (1)' }),
      ).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: 'Science (3)' }),
      ).toBeChecked();
      await waitFor(() =>
        expect(
          calls.filter(({ path }) => path === 'course.publicSearch').at(-1)
            ?.input,
        ).toMatchObject({
          q: 'linear',
          categoryId: 'cat-1',
          levels: ['advanced'],
          durationBands: ['lt2'],
        }),
      );
    });

    it('browses with filters and no text', async () => {
      const { calls } = filtered('/search?levels=%5B%22beginner%22%5D');

      expect(
        await screen.findByRole('heading', { name: 'Browse courses' }),
      ).toBeInTheDocument();
      expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();
      const [call] = calls.filter(({ path }) => path === 'course.publicSearch');
      expect(call.input).not.toHaveProperty('q');
    });

    it('shows the empty state, with a way to clear, for values that match nothing', async () => {
      const { user } = renderWithCoreApi(null, {
        routeTree,
        path: '/search?levels=%5B%22expert%22%5D',
        signedIn: false,
        handlers: {
          'course.publicSearch': () => ({
            items: [],
            cursor: null,
            facets: {
              ...facets,
              levels: [{ value: 'expert', count: 0 }],
            },
          }),
          'category.list': () => [],
        },
      });

      expect(await screen.findByText('No courses match')).toBeInTheDocument();
      await user.click(
        screen.getAllByRole('button', { name: 'Clear filters' })[0],
      );
      expect(
        await screen.findByRole('heading', { name: 'Search for a course' }),
      ).toBeInTheDocument();
    });

    it('offers the sort and minimum rating, defaulting to relevance and any', async () => {
      filtered('/search?query=linear');

      expect(await screen.findByLabelText('Sort by')).toHaveValue('relevance');
      for (const name of [
        'Relevance',
        'Highest rated',
        'Newest',
        'Any',
        '4.5 and up',
        '4.0 and up',
        '3.5 and up',
        '3.0 and up',
      ]) {
        expect(screen.getByRole('option', { name })).toBeInTheDocument();
      }
      expect(screen.getByLabelText('Minimum rating')).toHaveValue('');
    });

    it('puts a chosen sort in the address and the request, and clears it', async () => {
      const { router, calls, user } = filtered('/search?query=linear');

      await user.selectOptions(
        await screen.findByLabelText('Sort by'),
        'Highest rated',
      );

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          query: 'linear',
          sort: 'rating',
        }),
      );
      await waitFor(() =>
        expect(
          calls.filter(({ path }) => path === 'course.publicSearch').at(-1)
            ?.input,
        ).toMatchObject({ q: 'linear', sort: 'rating' }),
      );

      await user.selectOptions(screen.getByLabelText('Sort by'), 'Relevance');
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ query: 'linear' }),
      );
      await waitFor(() =>
        expect(
          calls.filter(({ path }) => path === 'course.publicSearch').at(-1)
            ?.input,
        ).not.toHaveProperty('sort'),
      );
    });

    it('puts a chosen minimum rating in the address and the request, and clears it', async () => {
      const { router, calls, user } = filtered('/search?query=linear');

      await user.selectOptions(
        await screen.findByLabelText('Minimum rating'),
        '4.0 and up',
      );

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          query: 'linear',
          minRating: 4,
        }),
      );
      await waitFor(() =>
        expect(
          calls.filter(({ path }) => path === 'course.publicSearch').at(-1)
            ?.input,
        ).toMatchObject({ q: 'linear', minRating: 4 }),
      );

      await user.click(
        await screen.findByRole('button', { name: 'Clear filters' }),
      );
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ query: 'linear' }),
      );
      expect(screen.getByLabelText('Minimum rating')).toHaveValue('');
    });

    it('restores the sort and minimum rating from the address', async () => {
      const { calls } = filtered(
        '/search?query=linear&sort=newest&minRating=3.5',
      );

      expect(await screen.findByLabelText('Sort by')).toHaveValue('newest');
      expect(screen.getByLabelText('Minimum rating')).toHaveValue('3.5');
      await waitFor(() =>
        expect(
          calls.filter(({ path }) => path === 'course.publicSearch').at(-1)
            ?.input,
        ).toMatchObject({ sort: 'newest', minRating: 3.5 }),
      );
    });

    it('shows each result’s rating, or that it has none', async () => {
      renderWithCoreApi(null, {
        routeTree,
        path: '/search?query=linear',
        signedIn: false,
        handlers: {
          'course.publicSearch': () => ({
            items: [
              {
                ...hit('linalg', 'Linear Algebra'),
                ratingAverage: 4.6,
                ratingCount: 128,
              },
              { ...hit('calc', 'Calculus'), ratingCount: 0 },
            ],
            cursor: null,
            facets,
          }),
          'category.list': () => [],
        },
      });

      expect(await screen.findByText('4.6')).toBeInTheDocument();
      expect(screen.getByText('(128 ratings)')).toBeInTheDocument();
      expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    });

    it('shows each course’s level, language and duration', async () => {
      renderWithCoreApi(null, {
        routeTree,
        path: '/search?query=linear',
        signedIn: false,
        handlers: {
          'course.publicSearch': () => ({
            items: [
              {
                ...hit('linalg', 'Linear Algebra'),
                category: { id: 'cat-1', name: 'Science', slug: 'science' },
                level: 'advanced',
                language: 'fr',
                durationHours: 12,
              },
            ],
            cursor: null,
            facets,
          }),
          'category.list': () => [],
        },
      });

      expect(await screen.findByText('Science')).toBeInTheDocument();
      expect(screen.getByText('12 hours')).toBeInTheDocument();
      expect(screen.getByText('Advanced')).toBeInTheDocument();
      expect(screen.getByText('French')).toBeInTheDocument();
    });
  });
});
