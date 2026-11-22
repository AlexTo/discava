/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '#components/ui/dialog';
import { useReturnFocus } from './use-return-focus';

function Harness({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const { onCloseAutoFocus } = useReturnFocus(open);
  return (
    <>
      {showOpener && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (removeOpener) setShowOpener(false);
          }}
        >
          Open
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Title</DialogTitle>
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('useReturnFocus', () => {
  it('returns focus to the button focused before opening', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('runs the default when the opener was removed', async () => {
    render(<Harness removeOpener />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
