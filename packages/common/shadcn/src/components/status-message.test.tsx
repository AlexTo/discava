/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusMessage } from './status-message';

describe('StatusMessage', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders the status region while empty', () => {
    render(<StatusMessage message={null} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows the text, then clears it after clearAfter', () => {
    render(<StatusMessage message="Saved" clearAfter={1000} />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('sets a repeated message again', () => {
    const { rerender } = render(
      <StatusMessage message="Saved" clearAfter={1000} />,
    );
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    rerender(<StatusMessage message={null} clearAfter={1000} />);
    rerender(<StatusMessage message="Saved" clearAfter={1000} />);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});
