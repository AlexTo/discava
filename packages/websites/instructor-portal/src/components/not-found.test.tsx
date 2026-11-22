/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  value: { isAuthenticated: false, user: undefined } as {
    isAuthenticated: boolean;
    user?: { profile: Record<string, unknown> };
  },
}));
vi.mock('react-oidc-context', () => ({ useAuth: () => auth.value }));
vi.mock('./app-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    Link: ({
      to,
      children,
      ...props
    }: { to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  });
});

const { NotFound, RootNotFound } = await import('./not-found');

beforeEach(() => {
  auth.value = { isAuthenticated: false, user: undefined };
});

describe('NotFound', () => {
  it('shows the heading and a link home, and draws no shell of its own', () => {
    render(<NotFound />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument();
  });
});

describe('RootNotFound', () => {
  it('draws the shell for a signed-in instructor', () => {
    auth.value = {
      isAuthenticated: true,
      user: { profile: { 'cognito:groups': ['instructor'] } },
    };
    render(<RootNotFound />);

    expect(screen.getByTestId('shell')).toContainElement(
      screen.getByRole('heading', { name: 'Page not found' }),
    );
  });

  it.each([
    ['signed out', { isAuthenticated: false, user: undefined }],
    [
      'a signed-in student',
      {
        isAuthenticated: true,
        user: { profile: { 'cognito:groups': ['student'] } },
      },
    ],
  ])('draws no shell for %s', (_, value) => {
    auth.value = value;
    render(<RootNotFound />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument();
  });
});
