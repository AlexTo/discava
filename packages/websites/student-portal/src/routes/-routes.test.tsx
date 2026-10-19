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
  'course.publicList': () => ({ items: [course] }),
  'course.publicView': () => course,
  'course.myEnrolment': () => null,
};

const open = (
  path: string,
  options: { signedIn?: boolean; cognito?: boolean } = {},
) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    handlers,
    signedIn: options.signedIn ?? false,
    cognito: options.cognito,
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

  it('shows signed-in students their own home', async () => {
    open('/', { signedIn: true });
    expect(
      await screen.findByRole('heading', { name: /Welcome back/ }),
    ).toBeInTheDocument();
  });
});

describe('old links', () => {
  it.each([
    ['/dashboard', '/'],
    ['/courses/course-1', '/learn/course-1'],
    ['/preview/course-1', '/learn/course-1'],
    ['/course/course-1', '/learn/course-1/home'],
  ])('send %s to %s', async (from, to) => {
    const { router } = open(from, { signedIn: true });
    expect((await pathAfterLoad(router)).pathname).toBe(to);
  });
});

describe('/learn/<courseId>/home', () => {
  it('asks signed-out visitors to sign in, then come back', async () => {
    const { router } = open('/learn/course-1/home', { cognito: true });

    const location = await pathAfterLoad(router);
    expect(location.pathname).toBe('/signin');
    expect(location.search).toEqual({ redirect: '/learn/course-1/home' });
  });

  it('lets signed-in students in', async () => {
    const { router } = open('/learn/course-1/home', {
      signedIn: true,
      cognito: true,
    });
    expect((await pathAfterLoad(router)).pathname).toBe('/learn/course-1/home');
  });

  it('is open to everyone without Cognito, as in local dev', async () => {
    const { router } = open('/learn/course-1/home');
    expect((await pathAfterLoad(router)).pathname).toBe('/learn/course-1/home');
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
