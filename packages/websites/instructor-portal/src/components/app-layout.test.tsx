/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The shell needs the router and the signed-in user; a list of its nav items
// as links shows where each one leads.
vi.mock('@discava/common-shadcn/components/portal-shell', () => ({
  PortalShell: ({
    navItems,
  }: {
    navItems: { label: string; to: string }[];
  }) => (
    <nav>
      {navItems.map(({ label, to }) => (
        <a key={to} href={to}>
          {label}
        </a>
      ))}
    </nav>
  ),
}));
vi.mock('@discava/common-web-utils/runtime-config', () => ({
  useRuntimeConfig: () => ({}),
}));

const { default: AppLayout } = await import('./app-layout');

describe('AppLayout', () => {
  it('links Earnings to /earnings', () => {
    render(<AppLayout>content</AppLayout>);

    expect(screen.getByRole('link', { name: 'Earnings' })).toHaveAttribute(
      'href',
      '/earnings',
    );
  });
});
