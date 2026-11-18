/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RatingSummary } from './rating-summary';

describe('RatingSummary', () => {
  it('shows the average and the number of ratings', () => {
    render(<RatingSummary average={4.6} count={128} />);
    expect(screen.getByText('4.6')).toBeInTheDocument();
    expect(screen.getByText('(128 ratings)')).toBeInTheDocument();
  });

  it('shows one decimal for a whole average', () => {
    render(<RatingSummary average={4} count={2} />);
    expect(screen.getByText('4.0')).toBeInTheDocument();
  });

  it('uses the singular for one rating', () => {
    render(<RatingSummary average={5} count={1} />);
    expect(screen.getByText('(1 rating)')).toBeInTheDocument();
  });

  it('says there are no ratings, with no number, for an unrated course', () => {
    const { container } = render(<RatingSummary count={0} />);
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('renders nothing where ratings are not known', () => {
    const { container } = render(<RatingSummary />);
    expect(container).toBeEmptyDOMElement();
  });
});
