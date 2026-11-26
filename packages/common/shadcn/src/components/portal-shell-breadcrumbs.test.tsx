/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, within } from '@testing-library/react';
import { Home } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

const base = '/my-courses/c1/assignments/a1/submissions';
// Stable, as the router's are: PortalShell's effects depend on their identity.
const router = {
  // Every path has a page except the assignment's own.
  matchRoutes: (href: string) => [
    { routeId: href, status: 'success', params: {} },
  ],
  routesById: new Proxy(
    {},
    {
      get: (_target, id: string) => ({
        fullPath: id === '/my-courses/c1/assignments/a1' ? '/x' : id,
      }),
    },
  ),
};
const location = { pathname: `${base}/u1` };

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

import { useBreadcrumbLabel, useBreadcrumbOptions } from './breadcrumb-label';
import { PortalShell } from './portal-shell';

const Page = ({ href = base }: { href?: string }) => {
  useBreadcrumbLabel('Walk assignment', '/my-courses/c1/assignments/a1');
  useBreadcrumbOptions('/my-courses/c1/assignments/a1', { href });
  useBreadcrumbOptions(base, { hidden: true });
  return <h1>Submission</h1>;
};

const shell = (child: React.ReactNode) => (
  <PortalShell
    portal="instructor"
    label="Instructor"
    navItems={[{ label: 'Home', to: '/', icon: Home }]}
    segmentLabels={{ assignments: 'Assignments' }}
  >
    {child}
  </PortalShell>
);

describe('PortalShell breadcrumb options', () => {
  it('follows a changed link and drops the options with the page', async () => {
    const { rerender } = render(shell(<Page />));
    await screen.findByRole('link', { name: 'Walk assignment' });

    rerender(shell(<Page href="/elsewhere" />));
    expect(
      await screen.findByRole('link', { name: 'Walk assignment' }),
    ).toHaveAttribute('href', '/elsewhere');

    rerender(shell(<h1>Other</h1>));
    expect(screen.queryByRole('link', { name: 'Walk assignment' })).toBeNull();
  });

  it('links a crumb elsewhere and hides a crumb a page asks to drop', async () => {
    render(shell(<Page />));

    const trail = await screen.findByRole('navigation', {
      name: 'breadcrumb',
    });
    expect(
      await within(trail).findByRole('link', { name: 'Walk assignment' }),
    ).toHaveAttribute('href', base);
    expect(within(trail).queryByText('submissions')).toBeNull();
  });
});
