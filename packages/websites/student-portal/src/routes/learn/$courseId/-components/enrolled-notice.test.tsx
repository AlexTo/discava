/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithCoreApi } from '../../../../test/render-with-core-api';
import { EnrolledNotice } from './enrolled-notice';

const render = () =>
  renderWithCoreApi(
    <>
      <input aria-label="Field" />
      <EnrolledNotice courseTitle="Linear Algebra" />
    </>,
  );

describe('EnrolledNotice', () => {
  it('says the learner is enrolled when the history state says so', async () => {
    const { router } = render();
    await screen.findByLabelText('Field');
    await act(() => router.navigate({ to: '/', state: { enrolled: true } }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      "You're enrolled in Linear Algebra.",
    );
  });

  it('shows nothing without the state', async () => {
    render();

    await screen.findByLabelText('Field');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not move focus', async () => {
    const { router } = render();
    const field = await screen.findByLabelText('Field');
    field.focus();
    await act(() => router.navigate({ to: '/', state: { enrolled: true } }));

    await screen.findByRole('status');
    expect(field).toHaveFocus();
  });
});
