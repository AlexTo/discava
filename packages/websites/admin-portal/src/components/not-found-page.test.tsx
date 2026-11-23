/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    useLocation: () => ({ pathname: '/no-such-page' }),
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

import { NotFoundPage } from './not-found-page';

describe('the not-found page', () => {
  it('has one heading, a sentence and a link home', () => {
    render(<NotFoundPage />);

    expect(
      screen.getAllByRole('heading').map((heading) => heading.tagName),
    ).toEqual(['H1']);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    expect(screen.getByText("There's no page at this address.")).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toHaveAttribute('href', '/');
  });

  it('sets the page title', () => {
    render(<NotFoundPage />);

    expect(document.title).toContain('Page not found');
  });
});
