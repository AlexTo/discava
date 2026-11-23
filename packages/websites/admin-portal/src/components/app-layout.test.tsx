/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getBreadcrumbs } from '@discava/common-shadcn/components/portal-shell';
import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '../router';
import AppLayout, { segmentLabels } from './app-layout';

// The bell reads notifications from the core API, which this test has no
// need of.
vi.mock(
  '@discava/common-shadcn/components/notification-bell-container',
  () => ({
    NotificationBell: () => null,
  }),
);

// The routes the admin portal really has, as PortalShell checks them.
const adminPaths = new Set(Object.keys(router.routesByPath));
const routeExists = (href: string) => adminPaths.has(href);

const labels = (path: string) =>
  getBreadcrumbs(routeExists, path, 'Home', {}, segmentLabels).map(
    ({ text }) => text,
  );

describe('the admin breadcrumbs', () => {
  it.each([
    ['/categories', ['Home', 'Categories']],
    ['/reviews', ['Home', 'Reviews']],
    ['/certificates', ['Home', 'Certificates']],
    ['/payments', ['Home', 'Payments']],
    ['/settings/notifications', ['Home', 'Settings', 'Notification settings']],
    ['/settings/branding', ['Home', 'Settings', 'Branding']],
  ])('label %s', (path, expected) => {
    expect(labels(path)).toEqual(expected);
  });
});

describe('the admin breadcrumb links', () => {
  it.each(['/settings/branding', '/settings/notifications'])(
    'show Settings as text, not a link, on %s',
    (path) => {
      const crumbs = getBreadcrumbs(
        routeExists,
        path,
        'Home',
        {},
        segmentLabels,
      );
      expect(crumbs.map(({ href }) => href)).toEqual(['/', undefined, path]);
    },
  );

  it.each([
    '/categories',
    '/reviews',
    '/certificates',
    '/payments',
    '/settings/branding',
    '/settings/notifications',
  ])('only link to admin routes on %s', (path) => {
    for (const { href } of getBreadcrumbs(
      routeExists,
      path,
      'Home',
      {},
      segmentLabels,
    )) {
      if (href) expect(adminPaths.has(href)).toBe(true);
    }
  });
});

const renderLayout = () => {
  const root = createRootRoute({
    component: () => (
      <AppLayout>
        <Outlet />
      </AppLayout>
    ),
  });
  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <h1>Home</h1>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/payments',
      component: () => <h1>Payments</h1>,
    }),
  ]);
  const testRouter = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const auth = {
    isLoading: false,
    isAuthenticated: true,
    user: {
      access_token: 'test-token',
      profile: { sub: 'admin-1', 'cognito:groups': ['admin'] },
    },
  } as unknown as AuthContextProps;
  const user = userEvent.setup();
  render(
    <RuntimeConfigContext.Provider value={{ portals: {} }}>
      <AuthContext.Provider value={auth}>
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={testRouter} />
        </QueryClientProvider>
      </AuthContext.Provider>
    </RuntimeConfigContext.Provider>,
  );
  return { user };
};

describe('the admin layout', () => {
  it('focuses the new page heading after navigating from / to /payments', async () => {
    const { user } = renderLayout();
    await screen.findByRole('heading', { level: 1, name: 'Home' });

    await user.click(screen.getByRole('link', { name: 'Payments' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Payments' }),
    ).toHaveFocus();
  });
});

describe('the admin sidebar at a phone width', () => {
  const originalWidth = window.innerWidth;
  beforeEach(() => {
    window.innerWidth = 375;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  it('closes when a page is chosen', async () => {
    const { user } = renderLayout();
    await screen.findByRole('heading', { level: 1, name: 'Home' });

    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    const sidebar = await screen.findByRole('dialog');
    await user.click(within(sidebar).getByRole('link', { name: 'Payments' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Payments' }),
    ).toHaveFocus();
  });

  it('returns focus to the sidebar button on Escape', async () => {
    const { user } = renderLayout();
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    const trigger = screen.getByRole('button', { name: 'Toggle Sidebar' });

    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
