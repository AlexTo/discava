/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MathPopover, type MathPopoverProps } from './math-popover';

const renderPopover = (props: Partial<MathPopoverProps> = {}) => {
  const handlers = {
    onConfirm: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <MathPopover
      anchor={() => new DOMRect()}
      display={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
};

const field = () => screen.getByRole('textbox', { name: /LaTeX/ });
const preview = () => screen.getByRole('region', { name: 'Preview' });

describe('MathPopover', () => {
  it('previews the formula as it is typed', async () => {
    const { user } = renderPopover();

    expect(preview()).toHaveTextContent('The formula appears here');
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();

    await user.type(field(), '\\frac{{a}{{b}');

    expect(preview().querySelector('.katex')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Insert' })).toBeEnabled();
  });

  it("explains LaTeX it can't render and won't insert it", async () => {
    const { user, onConfirm } = renderPopover();

    await user.type(field(), '\\frac{{a}{{b');

    expect(screen.getByRole('alert')).toHaveTextContent(/expected '}'/i);
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
    await user.type(field(), '{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('inserts a snippet at the cursor', async () => {
    const { user } = renderPopover();

    await user.type(field(), 'x + ');
    await user.click(screen.getByRole('button', { name: 'Fraction' }));

    expect(field()).toHaveValue('x + \\frac{a}{b}');
  });

  it('inserts an inline formula with Enter, trimmed', async () => {
    const { user, onConfirm } = renderPopover();

    await user.type(field(), '  x^{{2}  {Enter}');

    expect(onConfirm).toHaveBeenCalledWith('x^{2}');
  });

  it('keeps Enter for new lines in a block formula; Ctrl+Enter inserts it', async () => {
    const { user, onConfirm } = renderPopover({ display: true });

    expect(screen.getByText('Block formula (LaTeX)')).toBeInTheDocument();
    await user.type(field(), 'a{Enter}b');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(field()).toHaveValue('a\nb');

    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onConfirm).toHaveBeenCalledWith('a\nb');
  });

  it('edits an existing formula, which can also be deleted', async () => {
    const { user, onConfirm, onDelete } = renderPopover({ latex: 'Ax = b' });

    expect(field()).toHaveValue('Ax = b');
    await user.type(field(), '_{{1}');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(onConfirm).toHaveBeenCalledWith('Ax = b_{1}');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('offers no Delete for a new formula, and closes on Cancel', async () => {
    const { user, onClose } = renderPopover();

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
