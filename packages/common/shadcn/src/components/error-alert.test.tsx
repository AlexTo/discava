/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorAlert } from './error-alert';

describe('ErrorAlert', () => {
  it('announces an error as an alert', () => {
    render(
      <ErrorAlert type="error" header="Could not save">
        Try again
      </ErrorAlert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByRole('alert')).toHaveTextContent('Try again');
  });

  it('is a status message by default', () => {
    render(<ErrorAlert header="Heads up">Details</ErrorAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('Heads up');
  });

  it('has no retry button without onRetry', () => {
    render(<ErrorAlert header="Heads up">Details</ErrorAlert>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a retry button that calls onRetry once', () => {
    const onRetry = vi.fn();
    render(
      <ErrorAlert header="Heads up" onRetry={onRetry}>
        Details
      </ErrorAlert>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // Left to auto-placement, the button falls in Alert's zero-width icon
  // column and its label spills out of the alert (#775).
  it('puts the retry button in the content column, at its own width', () => {
    render(
      <ErrorAlert header="Heads up" onRetry={() => undefined}>
        Details
      </ErrorAlert>,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass(
      'col-start-2',
      'justify-self-start',
    );
  });

  it('labels the retry button as asked', () => {
    render(
      <ErrorAlert
        header="Heads up"
        onRetry={() => undefined}
        retryLabel="Reload"
      >
        Details
      </ErrorAlert>,
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
