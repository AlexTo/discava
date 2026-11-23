/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Home } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

// Stable, as the router's are: PortalShell's effects depend on their identity.
const router = {
  matchRoutes: () => [{ routeId: '/', status: 'success' }],
  routesById: { '/': { fullPath: '/' } },
};
const location = { pathname: '/a' };

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

const shell = (heading: string) => (
  <PortalShell
    portal="admin"
    label="Admin"
    navItems={[{ label: 'Home', to: '/', icon: Home }]}
  >
    <h1>{heading}</h1>
  </PortalShell>
);

describe('PortalShell’s route announcer', () => {
  it('focuses the new page’s h1 after the pathname changes', async () => {
    const { rerender } = render(shell('Page A'));
    fireEvent.keyDown(document.body, { key: 'Tab' });
    location.pathname = '/b';
    rerender(shell('Page B'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Page B' })).toHaveFocus(),
    );
  });
});
