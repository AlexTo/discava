/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';

describe('link styles', () => {
  it('colours the Button link variant with --brand-link, not --primary', () => {
    render(<Button variant="link">Read more</Button>);
    const button = screen.getByRole('button', { name: 'Read more' });
    expect(button).toHaveClass('text-(--brand-link)');
    expect(button).not.toHaveClass('text-primary');
  });

  it('colours the Badge link variant with --brand-link, not --primary', () => {
    render(<Badge variant="link">New</Badge>);
    const badge = screen.getByText('New');
    expect(badge).toHaveClass('text-(--brand-link)');
    expect(badge).not.toHaveClass('text-primary');
  });
});
