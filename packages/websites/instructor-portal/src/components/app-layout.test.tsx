/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The shell needs the router and the signed-in user; a list of its nav items
// as links shows where each one leads, and the breadcrumb labels it was given
// are kept to check.
const shell = vi.hoisted(() => ({
  segmentLabels: {} as Record<string, string>,
}));
vi.mock('@discava/common-shadcn/components/portal-shell', () => ({
  PortalShell: ({
    navItems,
    segmentLabels,
  }: {
    navItems: { label: string; to: string }[];
    segmentLabels: Record<string, string>;
  }) => {
    shell.segmentLabels = segmentLabels;
    return (
      <nav>
        {navItems.map(({ label, to }) => (
          <a key={to} href={to}>
            {label}
          </a>
        ))}
      </nav>
    );
  },
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

  it.each([
    ['reviews', 'Reviews'],
    ['questions', 'Questions'],
    ['coupons', 'Coupons'],
  ])("names a course's %s page %s in the breadcrumbs", (segment, label) => {
    render(<AppLayout>content</AppLayout>);

    expect(shell.segmentLabels[segment]).toBe(label);
  });
});
