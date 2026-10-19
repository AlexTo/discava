/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { renderWithCoreApi } from '../../test/render-with-core-api';

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  modules: [],
};

const openSignIn = (
  search: string,
  { signedIn = false }: { signedIn?: boolean } = {},
) => {
  const signinRedirect = vi.fn(async () => {});
  const rendered = renderWithCoreApi(null, {
    routeTree,
    path: `/signin${search}`,
    signedIn,
    auth: { signinRedirect },
    handlers: {
      'course.publicView': () => course,
      'course.myEnrolment': () => null,
      'course.publicList': () => ({ items: [] }),
    },
  });
  return { ...rendered, signinRedirect };
};

describe('/signin', () => {
  it('sends the page to come back to through sign-in', async () => {
    const { signinRedirect } = openSignIn('?redirect=%2Fcourses%2Fcourse-1');

    await waitFor(() =>
      expect(signinRedirect).toHaveBeenCalledWith({
        state: { returnTo: '/courses/course-1' },
      }),
    );
    expect(signinRedirect).toHaveBeenCalledTimes(1);
  });

  it("doesn't send a page on another site", async () => {
    const { signinRedirect } = openSignIn(
      '?redirect=https%3A%2F%2Fevil.example%2Fphish',
    );

    await waitFor(() =>
      expect(signinRedirect).toHaveBeenCalledWith({
        state: { returnTo: undefined },
      }),
    );
  });

  it('takes someone already signed in straight to the page', async () => {
    const { router, signinRedirect } = openSignIn(
      '?redirect=%2Fcourses%2Fcourse-1',
      { signedIn: true },
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/courses/course-1'),
    );
    expect(signinRedirect).not.toHaveBeenCalled();
  });

  it('takes someone already signed in to the dashboard by default', async () => {
    const { router } = openSignIn('', { signedIn: true });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/dashboard'),
    );
  });
});
