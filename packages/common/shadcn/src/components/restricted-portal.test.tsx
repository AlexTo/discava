/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RestrictedPortal } from './restricted-portal';

describe('RestrictedPortal', () => {
  it('says who the portal is for, links elsewhere, and signs out', async () => {
    const onSignOut = vi.fn();
    render(
      <RestrictedPortal
        title="The instructor portal is for instructors"
        links={[
          { label: 'Go to the student portal', href: 'https://learn.example' },
        ]}
        onSignOut={onSignOut}
      >
        <p>You're signed in as Bob.</p>
      </RestrictedPortal>,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The instructor portal is for instructors',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("You're signed in as Bob.")).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the student portal' }),
    ).toHaveAttribute('href', 'https://learn.example');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
