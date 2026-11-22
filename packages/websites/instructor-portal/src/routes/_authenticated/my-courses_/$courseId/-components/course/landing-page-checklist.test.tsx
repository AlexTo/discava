/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, {
    // A real Link needs a router; render the address it would link to, "." being
    // the course page.
    Link: ({
      to,
      hash,
      children,
      ...props
    }: {
      to: string;
      hash?: string;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={`${to === '.' ? '/my-courses/c1' : to}${hash ? `#${hash}` : ''}`}
        {...props}
      >
        {children}
      </a>
    ),
  });
});

import { LandingPageChecklist } from './landing-page-checklist';

const line = (label: string) =>
  screen.getByText(label).closest('li') as HTMLElement;

const renderChecklist = (
  props: Partial<Parameters<typeof LandingPageChecklist>[0]> = {},
) =>
  render(
    <LandingPageChecklist
      hasOutcomes={false}
      hasRequirements={false}
      hasPreview={false}
      hasImage={false}
      {...props}
    />,
  );

describe('LandingPageChecklist', () => {
  it('shows five lines, checking the profile until it has loaded', () => {
    renderChecklist();

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(
      within(line('Your profile (headline and photo)')).getByText('Checking…'),
    ).toBeVisible();
  });

  it('ticks the profile when it has a headline and photo', () => {
    renderChecklist({ hasProfile: true });
    expect(
      within(line('Your profile (headline and photo)')).getByText('Done'),
    ).toBeVisible();
  });

  it('links to the profile editor when it lacks one', () => {
    renderChecklist({ hasProfile: false });
    const profile = line('Your profile (headline and photo)');
    expect(within(profile).getByText('Not yet')).toBeVisible();
    expect(within(profile).getByRole('link')).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it.each([
    ['Learning outcomes', { hasOutcomes: true }],
    ['Requirements', { hasRequirements: true }],
    ['Preview video', { hasPreview: true }],
    ['Course image', { hasImage: true }],
  ])('%s is done when present', (label, props) => {
    renderChecklist(props);

    expect(within(line(label)).getByText('Done')).toBeVisible();
    expect(within(line(label)).queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['Learning outcomes', '/my-courses/c1#landing-page'],
    ['Requirements', '/my-courses/c1#landing-page'],
    ['Preview video', '/my-courses/c1#preview-video'],
    ['Course image', '/my-courses/c1#course-image'],
  ])('%s links to its fix when missing', (label, href) => {
    renderChecklist();

    expect(within(line(label)).getByText('Not yet')).toBeVisible();
    expect(within(line(label)).getByRole('link')).toHaveAttribute('href', href);
  });

  it('keeps every "Add it" link on the course page, with its own name', () => {
    const { container } = renderChecklist({ hasProfile: false });

    expect(container.querySelector('a[href^="#"]')).toBeNull();
    const names = screen
      .getAllByRole('link', { name: /^Add it: / })
      .map((link) => link.getAttribute('aria-label'));
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
  });

  it('links to the public page only when one is given', () => {
    const { rerender } = renderChecklist();
    expect(
      screen.queryByRole('link', { name: 'View public page' }),
    ).not.toBeInTheDocument();

    rerender(
      <LandingPageChecklist
        publicPageUrl="http://student.test/learn/c1"
        hasOutcomes={false}
        hasRequirements={false}
        hasPreview={false}
        hasImage={false}
      />,
    );
    const link = screen.getByRole('link', { name: 'View public page' });
    expect(link).toHaveAttribute('href', 'http://student.test/learn/c1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('never renders a Publish control, so it cannot disable one', () => {
    renderChecklist();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
