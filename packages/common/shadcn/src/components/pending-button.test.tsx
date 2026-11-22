/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PendingButton } from './pending-button';

describe('PendingButton', () => {
  it('keeps focus when it becomes pending, and never sets disabled', () => {
    const { rerender } = render(
      <PendingButton pending={false} pendingLabel="Saving…">
        Save
      </PendingButton>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    rerender(
      <PendingButton pending pendingLabel="Saving…">
        Save
      </PendingButton>,
    );
    const pending = screen.getByRole('button', { name: 'Saving…' });
    expect(pending).toHaveFocus();
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    expect(pending).not.toBeDisabled();
  });

  it('ignores clicks while pending', async () => {
    const onClick = vi.fn();
    render(
      <PendingButton pending pendingLabel="Saving…" onClick={onClick}>
        Save
      </PendingButton>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onClick when not pending', async () => {
    const onClick = vi.fn();
    render(
      <PendingButton pending={false} pendingLabel="Saving…" onClick={onClick}>
        Save
      </PendingButton>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not submit its form while pending', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PendingButton type="submit" pending pendingLabel="Saving…">
          Save
        </PendingButton>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('switches the label back when pending ends', async () => {
    function Harness() {
      const [pending, setPending] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setPending(false)}>
            finish
          </button>
          <PendingButton pending={pending} pendingLabel="Saving…">
            Save
          </PendingButton>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'finish' }));
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });
});
