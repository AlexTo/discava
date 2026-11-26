/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Home } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

// Stable, as the router's are: PortalShell's effects depend on their identity.
const router = {
  matchRoutes: () => [{ routeId: '/', status: 'success' }],
  routesById: { '/': { fullPath: '/' } },
};
const location = { pathname: '/a' };
window.innerWidth = 500;

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
    useLocation: () => location,
    useRouter: () => router,
  });
});
vi.mock('./notification-bell-container', () => ({
  NotificationBell: () => null,
}));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));

import { PortalShell } from './portal-shell';
import { MAIN_CONTENT_ID } from './skip-link';

const shell = (page: React.ReactNode = <h1>Page</h1>) => (
  <PortalShell
    portal="admin"
    label="Admin"
    navItems={[{ label: 'Home', to: '/', icon: Home }]}
  >
    {page}
  </PortalShell>
);

const openSidebar = () => {
  fireEvent.click(screen.getByRole('button', { name: /toggle sidebar/i }));
  return screen.findByRole('dialog');
};

describe('PortalShell’s phone sidebar', () => {
  it('closes when the pathname changes', async () => {
    location.pathname = '/a';
    const { rerender } = render(shell());
    await openSidebar();
    location.pathname = '/b';
    rerender(shell());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('returns focus to the sidebar trigger when closed with Escape', async () => {
    location.pathname = '/a';
    render(shell());
    const dialog = await openSidebar();
    fireEvent.keyDown(within(dialog).getByText('Admin'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /toggle sidebar/i }),
      ).toHaveFocus(),
    );
  });

  it('still returns focus to the trigger after a navigation made with the sidebar closed', async () => {
    location.pathname = '/a';
    const { rerender } = render(shell());
    location.pathname = '/b';
    rerender(shell());
    const dialog = await openSidebar();
    fireEvent.keyDown(within(dialog).getByText('Admin'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /toggle sidebar/i }),
      ).toHaveFocus(),
    );
  });

  it('focuses the new page’s h1 after a navigation made from the open sidebar', async () => {
    location.pathname = '/a';
    const { rerender } = render(shell());
    const dialog = await openSidebar();
    within(dialog).getByRole('link', { name: 'Home' }).focus();
    location.pathname = '/b';
    rerender(shell());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Page' })).toHaveFocus(),
    );
  });

  it('focuses the main content after a navigation from the open sidebar to a page without an h1', async () => {
    location.pathname = '/a';
    const { rerender } = render(shell());
    const dialog = await openSidebar();
    within(dialog).getByRole('link', { name: 'Home' }).focus();
    location.pathname = '/b';
    rerender(shell(<p>No heading</p>));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.getElementById(MAIN_CONTENT_ID)).toHaveFocus(),
    );
  });
});
