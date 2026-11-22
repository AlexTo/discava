/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingState } from './loading-state';

describe('LoadingState', () => {
  it('is a status region whose text is the label', () => {
    render(<LoadingState label="Loading the course…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the course…');
  });

  it('centres a page-sized state', () => {
    render(<LoadingState label="Loading…" size="page" />);
    expect(screen.getByRole('status')).toHaveClass('min-h-[50vh]');
  });
});
