/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  it('shows five lines, with Coming soon for the profile', () => {
    renderChecklist();

    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(
      within(line('Your profile (headline and photo)')).getByText(
        'Coming soon',
      ),
    ).toBeVisible();
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
    ['Learning outcomes', '#landing-page-heading'],
    ['Requirements', '#landing-page-heading'],
    ['Preview video', '#landing-page-heading'],
    ['Course image', '#course-image'],
  ])('%s links to its fix when missing', (label, href) => {
    renderChecklist();

    expect(within(line(label)).getByText('Not yet')).toBeVisible();
    expect(within(line(label)).getByRole('link')).toHaveAttribute('href', href);
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
