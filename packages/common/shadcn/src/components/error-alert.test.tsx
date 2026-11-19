/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
