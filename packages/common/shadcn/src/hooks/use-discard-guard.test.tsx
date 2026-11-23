/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '#components/ui/dialog';
import { useDiscardGuard } from './use-discard-guard';

function Harness({ initiallyDirty }: { initiallyDirty: boolean }) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState(initiallyDirty ? 'typed' : '');
  const { contentProps, requestClose, confirmation } = useDiscardGuard({
    dirty: value !== '',
    discard: () => {
      setValue('');
      setOpen(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogContent showCloseButton={false} {...contentProps}>
        <DialogTitle>Edit</DialogTitle>
        <DialogDescription>Edit it.</DialogDescription>
        <input
          aria-label="Name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" onClick={requestClose}>
          Close
        </button>
        {confirmation}
      </DialogContent>
    </Dialog>
  );
}

describe('useDiscardGuard', () => {
  it('closes at once when clean', async () => {
    render(<Harness initiallyDirty={false} />);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks on Escape when dirty, and Keep editing returns to the field', async () => {
    render(<Harness initiallyDirty />);
    const field = screen.getByLabelText('Name');
    field.focus();
    await userEvent.keyboard('{Escape}');
    expect(
      await screen.findByText('Discard unsaved changes?'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('discards on Discard changes', async () => {
    render(<Harness initiallyDirty />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Discard changes' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
