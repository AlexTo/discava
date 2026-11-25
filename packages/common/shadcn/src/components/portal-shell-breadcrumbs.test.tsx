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

const Page = () => {
  useBreadcrumbLabel('Walk assignment', '/my-courses/c1/assignments/a1');
  useBreadcrumbOptions('/my-courses/c1/assignments/a1', { href: base });
  useBreadcrumbOptions(base, { hidden: true });
  return <h1>Submission</h1>;
};

describe('PortalShell breadcrumb options', () => {
  it('links a crumb elsewhere and hides a crumb a page asks to drop', async () => {
    render(
      <PortalShell
        portal="instructor"
        label="Instructor"
        navItems={[{ label: 'Home', to: '/', icon: Home }]}
        segmentLabels={{ assignments: 'Assignments' }}
      >
        <Page />
      </PortalShell>,
    );

    const trail = await screen.findByRole('navigation', {
      name: 'breadcrumb',
    });
    expect(
      await within(trail).findByRole('link', { name: 'Walk assignment' }),
    ).toHaveAttribute('href', base);
    expect(within(trail).queryByText('submissions')).toBeNull();
  });
});
