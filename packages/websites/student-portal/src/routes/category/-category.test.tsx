/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { ApiError, renderWithCoreApi } from '../../test/render-with-core-api';

const hit = (courseId: string, title: string) => ({
  courseId,
  title,
  tags: [],
});

const facets = {
  categories: [{ id: 'cat-1', name: 'Science', slug: 'science', count: 2 }],
  tags: [{ value: 'sql', count: 2 }],
  levels: [{ value: 'beginner', count: 2 }],
  languages: [],
  durationBands: [],
};

const science = { id: 'cat-1', name: 'Science', slug: 'science' };

const open = (
  path: string,
  handlers: Record<string, (input: unknown) => unknown> = {},
) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn: false,
    handlers: {
      'category.bySlug': () => ({ ...science, status: 'active' }),
      'category.list': () => [{ ...science, courseCount: 2 }],
      'course.publicSearch': () => ({
        items: [hit('physics', 'Physics'), hit('chem', 'Chemistry')],
        cursor: null,
        facets,
      }),
      ...handlers,
    },
  });

describe('/category/$slug', () => {
  it('shows the category name as the heading', async () => {
    open('/category/science');
    expect(
      await screen.findByRole('heading', { name: 'Science' }),
    ).toBeInTheDocument();
  });

  it('lists the category’s courses, searching with its id', async () => {
    const { calls } = open('/category/science');

    expect(await screen.findByText('Physics')).toBeInTheDocument();
    expect(screen.getByText('Chemistry')).toBeInTheDocument();
    expect(
      calls.filter(({ path }) => path === 'course.publicSearch').at(-1)?.input,
    ).toMatchObject({ categoryId: 'cat-1' });
  });

  it('has a filter panel without the category group', async () => {
    open('/category/science');

    expect(await screen.findByText('Level')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.queryByText('Category')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Science/ })).toBeNull();
  });

  it('scopes a text search to the category, in the address', async () => {
    const { router, user, calls } = open('/category/science');

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search Science' }),
      'physics{Enter}',
    );

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ query: 'physics' }),
    );
    await waitFor(() =>
      expect(
        calls.filter(({ path }) => path === 'course.publicSearch').at(-1)
          ?.input,
      ).toMatchObject({ q: 'physics', categoryId: 'cat-1' }),
    );
  });

  it('says when no courses match', async () => {
    open('/category/science', {
      'course.publicSearch': () => ({ items: [], cursor: null, facets }),
    });
    expect(await screen.findByText('No courses match')).toBeInTheDocument();
  });

  it('says not found for an unknown slug, without searching', async () => {
    const { calls } = open('/category/nope', {
      'category.bySlug': () => {
        throw new ApiError('NOT_FOUND', 'Category not found');
      },
    });

    expect(
      await screen.findByRole('heading', { name: 'Category not found' }),
    ).toBeInTheDocument();
    expect(calls.map(({ path }) => path)).not.toContain('course.publicSearch');
  });

  it('says an archived category is no longer available', async () => {
    const { calls } = open('/category/science', {
      'category.bySlug': () => ({ ...science, status: 'archived' }),
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Science is no longer available',
      }),
    ).toBeInTheDocument();
    expect(calls.map(({ path }) => path)).not.toContain('course.publicSearch');
  });

  it('waits and retries once while the collection cold-starts', async () => {
    let attempts = 0;
    open('/category/science', {
      'course.publicSearch': () => {
        attempts++;
        if (attempts === 1) {
          throw new ApiError('TIMEOUT', 'Search is starting up.');
        }
        return { items: [hit('physics', 'Physics')], cursor: null, facets };
      },
    });

    await waitFor(() => expect(attempts).toBeGreaterThan(1), {
      timeout: 10_000,
    });
    expect(await screen.findByText('Physics')).toBeInTheDocument();
  });

  it('empties the search box when the query leaves the address', async () => {
    const { router } = open('/category/science?query=abc');

    const box = await screen.findByRole('searchbox', {
      name: 'Search Science',
    });
    expect(box).toHaveValue('abc');
    expect(box).toHaveAttribute('name', 'query');
    expect(box).toHaveAttribute('autocomplete', 'off');

    await router.navigate({
      to: '/category/$slug',
      params: { slug: 'science' },
    });
    await waitFor(() => expect(box).toHaveValue(''));
  });
});
