/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ResponsivePanel } from './responsive-panel';

describe('ResponsivePanel', () => {
  it('starts closed and opens when the trigger is clicked', async () => {
    render(
      <ResponsivePanel label="Course outline">
        <p>Lesson links</p>
      </ResponsivePanel>,
    );
    const trigger = screen.getByRole('button', { name: /Course outline/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // jsdom has no layout: closed means the `hidden` class below lg.
    const content = screen.getByText('Lesson links').parentElement;
    expect(content).toHaveClass('hidden');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(content).not.toHaveClass('hidden');
  });

  it('shows the summary beside the label', () => {
    render(
      <ResponsivePanel label="Filters" summary="2 active">
        <p>content</p>
      </ResponsivePanel>,
    );
    const trigger = screen.getByRole('button', { name: /Filters/ });
    expect(trigger).toHaveTextContent('Filters');
    expect(trigger).toHaveTextContent('2 active');
  });

  it('separates the label from the summary in the accessible name', () => {
    render(
      <ResponsivePanel label="Filters" summary="1 active">
        <p>content</p>
      </ResponsivePanel>,
    );
    expect(
      screen.getByRole('button', { name: 'Filters, 1 active' }),
    ).toBeInTheDocument();
  });

  it('hides the trigger and shows the content from the lg breakpoint', () => {
    render(
      <ResponsivePanel label="Filters">
        <p>content</p>
      </ResponsivePanel>,
    );
    const trigger = screen.getByRole('button', { name: /Filters/ });
    expect(trigger).toHaveClass('lg:hidden');
    // Mounted while closed, so the lg class can show it without a click.
    expect(screen.getByText('content').parentElement).toHaveClass('lg:!block');
  });
});
