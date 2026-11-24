/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  // The track is 36x20px with a 1px border, so the ::after is offset from an
  // 18px-tall padding box: 3px above and below makes the 24px-tall target. An
  // absolute ::after with only top and bottom set has no width.
  it('stretches its hit area across the track and 3px past it', () => {
    render(<Switch aria-label="Email me" />);
    expect(screen.getByRole('switch', { name: 'Email me' })).toHaveClass(
      'relative',
      'after:absolute',
      'after:inset-x-0',
      'after:-inset-y-[3px]',
    );
  });
});
