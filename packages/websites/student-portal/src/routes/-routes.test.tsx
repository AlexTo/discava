/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../routeTree.gen';
import { renderWithCoreApi } from '../test/render-with-core-api';

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors, matrices and the four subspaces.',
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  modules: [],
};

const handlers = {
  'certificate.verify': () => ({
    certificateId: 'ABCD-EFGH-JKLM',
    learnerName: 'Ada Lovelace',
    courseTitle: 'Linear Algebra',
    completedAt: '2026-10-05T12:00:00.000Z',
  }),
  'course.publicList': () => ({ items: [course] }),
  'course.publicSearch': () => ({
    items: [{ courseId: 'course-1', title: 'Linear Algebra', tags: [] }],
    cursor: null,
    facets: {
      categories: [],
      tags: [],
      levels: [],
      languages: [],
      durationBands: [],
    },
  }),
  'category.list': () => [],
  'course.publicView': () => course,
  'course.myEnrolment': () => null,
  'review.summary': () => ({
    count: 1,
    average: 5,
    stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
  }),
  'review.list': () => ({
    items: [
      {
        reviewerName: 'Ada L.',
        rating: 5,
        text: 'Superb.',
        createdAt: '2026-10-05T12:00:00.000Z',
      },
    ],
    cursor: null,
  }),
};

const open = (path: string, options: { signedIn?: boolean } = {}) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    handlers,
    signedIn: options.signedIn ?? false,
  });

const pathAfterLoad = async (router: ReturnType<typeof open>['router']) => {
  await waitFor(() => expect(router.state.status).toBe('idle'));
  return router.state.location;
};

describe('/', () => {
  it('shows signed-out visitors the catalogue', async () => {
    open('/');
    expect(
      await screen.findByRole('heading', {
        name: 'Browse courses for every goal.',
      }),
    ).toBeInTheDocument();
  });

  it('offers the categories from the API as chips, with their counts', async () => {
    renderWithCoreApi(null, {
      routeTree,
      path: '/',
      signedIn: false,
      handlers: {
        ...handlers,
        'category.list': () => [
          { id: 'cat-1', name: 'Science', slug: 'science', courseCount: 3 },
          { id: 'cat-2', name: 'Art', slug: 'art', courseCount: 0 },
        ],
      },
    });

    expect(
      await screen.findByRole('link', { name: 'Science (3)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Art (0)' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Technology' })).toBeNull();
  });

  it('links each category chip to its landing page', async () => {
    renderWithCoreApi(null, {
      routeTree,
      path: '/',
      signedIn: false,
      handlers: {
        ...handlers,
        'category.list': () => [
          { id: 'cat-1', name: 'Science', slug: 'science', courseCount: 3 },
        ],
      },
    });

    expect(
      await screen.findByRole('link', { name: 'Science (3)' }),
    ).toHaveAttribute('href', '/category/science');
  });

  it('shows signed-in students their own home', async () => {
    open('/', { signedIn: true });
    expect(
      await screen.findByRole('heading', { name: /^Welcome/ }),
    ).toBeInTheDocument();
  });
});

describe('/learn/<courseId>/home', () => {
  it('asks signed-out visitors to sign in, then come back', async () => {
    const { router } = open('/learn/course-1/home');

    const location = await pathAfterLoad(router);
    expect(location.pathname).toBe('/signin');
    expect(location.search).toEqual({ redirect: '/learn/course-1/home' });
  });

  it('lets signed-in students in', async () => {
    const { router } = open('/learn/course-1/home', { signedIn: true });
    expect((await pathAfterLoad(router)).pathname).toBe('/learn/course-1/home');
  });
});

describe('/learn/<courseId>', () => {
  it('shows a signed-out visitor the reviews without sending them to sign in', async () => {
    const { router, calls } = open('/learn/course-1');

    expect(await screen.findByText('Superb.')).toBeInTheDocument();
    expect((await pathAfterLoad(router)).pathname).toBe('/learn/course-1');
    const paths = calls.map(({ path }) => path);
    expect(paths).toContain('review.summary');
    expect(paths).toContain('review.list');
    expect(paths).not.toContain('review.mine');
    expect(paths).not.toContain('course.myEnrolment');
  });
});

describe('the top bar', () => {
  it('searches courses from any page', async () => {
    const { router, user } = open('/learn/course-1');

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search courses' }),
      '  linear algebra {Enter}',
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    expect(router.state.location.search).toEqual({ query: 'linear algebra' });
  });

  it('offers signed-out visitors to sign in', async () => {
    open('/');
    expect(
      await screen.findByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/signin');
    expect(screen.queryByRole('button', { name: 'Open user menu' })).toBeNull();
  });

  it('shows signed-in students their account menu', async () => {
    open('/', { signedIn: true });
    expect(
      await screen.findByRole('button', { name: 'Open user menu' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});

describe('/certificates/<ID>', () => {
  it('is open to a signed-out visitor, with no sign-in redirect', async () => {
    const { router, calls } = open('/certificates/ABCD-EFGH-JKLM');

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    const location = await pathAfterLoad(router);
    expect(location.pathname).toBe('/certificates/ABCD-EFGH-JKLM');
    expect(calls.map((c) => c.path)).toEqual(['certificate.verify']);
  });
});
