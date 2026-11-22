/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { BrandContextProvider } from '@discava/common-web-utils/brand';
import { render, screen } from '@testing-library/react';
import { Home } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

// Stable, as the router's are: PortalShell's effects depend on their identity.
const router = {
  matchRoutes: () => [{ routeId: '/', status: 'success' }],
  routesById: { '/': { fullPath: '/' } },
};
const location = { pathname: '/' };

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

const shell = () => (
  <PortalShell
    portal="admin"
    label="Admin"
    navItems={[{ label: 'Home', to: '/', icon: Home }]}
  >
    page
  </PortalShell>
);

describe('PortalShell’s header brand', () => {
  it('shows the Discava logo and name when there is no brand', () => {
    render(shell());
    expect(screen.getByRole('img', { name: 'Discava logo' })).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/svg+xml'),
    );
    expect(screen.getByText('Discava')).toBeInTheDocument();
  });

  it('follows the brand: its logo as the image source, its name for the alt and text', () => {
    const brand = resolveBrand(
      {
        name: 'Acme Academy',
        showNameBesideLogo: true,
        colour: null,
        logoKey: 'brand/logo/0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12.png',
        iconKey: null,
        shareImageKey: null,
      },
      'https://media.test/',
    );
    render(
      <BrandContextProvider value={brand}>{shell()}</BrandContextProvider>,
    );
    const logo = screen.getByRole('img', { name: 'Acme Academy logo' });
    expect(logo).toHaveAttribute(
      'src',
      'https://media.test/brand/logo/0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12.png',
    );
    expect(screen.getByText('Acme Academy')).toBeInTheDocument();
  });

  it('shows the name only when showNameBesideLogo is on; the alt always uses it', () => {
    const brand = {
      ...resolveBrand(
        {
          name: 'Acme Academy',
          showNameBesideLogo: false,
          colour: null,
          logoKey: null,
          iconKey: null,
          shareImageKey: null,
        },
        'https://media.test/',
      ),
    };
    render(
      <BrandContextProvider value={brand}>{shell()}</BrandContextProvider>,
    );
    expect(
      screen.getByRole('img', { name: 'Acme Academy logo' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Acme Academy')).not.toBeInTheDocument();
  });

  it('does not crop a wide logo: it is contained, at the header height, up to four times as wide', () => {
    render(shell());
    const logo = screen.getByRole('img', { name: 'Discava logo' });
    expect(logo).toHaveClass('object-contain', 'h-10', 'w-auto', 'max-w-40');
    expect(logo).not.toHaveClass('object-cover');
  });
});
