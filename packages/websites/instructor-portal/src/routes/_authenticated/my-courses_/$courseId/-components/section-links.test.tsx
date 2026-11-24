/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let hash = '';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    useRouterState: ({
      select,
    }: {
      select: (state: { location: { hash: string } }) => string;
    }) => select({ location: { hash } }),
    Link: ({
      children,
      hash: to,
      className,
    }: {
      children: React.ReactNode;
      hash: string;
      className?: string;
    }) => (
      <a href={`/my-courses/c1#${to}`} className={className}>
        {children}
      </a>
    ),
  });
});

const { SectionLinks } = await import('./section-links');

const sections = [
  { id: 'content', label: 'Content' },
  { id: 'announcements', label: 'Announcements' },
];

beforeEach(() => {
  hash = '';
});

describe('SectionLinks', () => {
  it('links to each section, keeping the course path', () => {
    render(<SectionLinks sections={sections} />);
    const nav = screen.getByRole('navigation', { name: 'Course sections' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Content' })).toHaveAttribute(
      'href',
      '/my-courses/c1#content',
    );
    expect(screen.getByRole('link', { name: 'Announcements' })).toHaveAttribute(
      'href',
      '/my-courses/c1#announcements',
    );
  });

  it('has no link for a section that is not listed', () => {
    render(<SectionLinks sections={sections} />);
    expect(
      screen.queryByRole('link', { name: 'Archived' }),
    ).not.toBeInTheDocument();
  });

  it('focuses the heading after a hash change', () => {
    hash = 'announcements';
    render(
      <>
        <SectionLinks sections={sections} />
        <h2 id="announcements" tabIndex={-1}>
          Announcements
        </h2>
      </>,
    );
    expect(
      screen.getByRole('heading', { name: 'Announcements' }),
    ).toHaveFocus();
  });
});
