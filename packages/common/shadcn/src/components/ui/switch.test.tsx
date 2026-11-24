/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  // The track is 36x20px; its ::after is the 24px-tall target. An absolute
  // ::after with only top and bottom set has no width, so it adds nothing.
  it('stretches its hit area across the track and 2px above and below', () => {
    render(<Switch aria-label="Email me" />);
    expect(screen.getByRole('switch', { name: 'Email me' })).toHaveClass(
      'relative',
      'after:absolute',
      'after:inset-x-0',
      'after:-inset-y-0.5',
    );
  });
});
