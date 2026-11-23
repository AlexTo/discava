/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFocusAfterRemoval } from './use-focus-after-removal';

function List({ ids }: { ids: string[] }) {
  const { register } = useFocusAfterRemoval(ids, () =>
    document.getElementById('heading'),
  );
  return (
    <div>
      <h2 id="heading" tabIndex={-1}>
        Heading
      </h2>
      {ids.map((id) => (
        <div key={id} ref={register(id)}>
          <button type="button">{id}</button>
        </div>
      ))}
    </div>
  );
}

const removeFocused = (
  rerender: (ui: React.ReactElement) => void,
  ids: string[],
) => {
  (document.activeElement as HTMLElement).blur();
  rerender(<List ids={ids} />);
};

describe('useFocusAfterRemoval', () => {
  it('focuses the next item when one goes', async () => {
    const { rerender } = render(<List ids={['a', 'b', 'c']} />);
    screen.getByText('b').focus();
    removeFocused(rerender, ['a', 'c']);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText('c')),
    );
  });

  it('focuses the previous item when the last one goes', async () => {
    const { rerender } = render(<List ids={['a', 'b']} />);
    screen.getByText('b').focus();
    removeFocused(rerender, ['a']);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText('a')),
    );
  });

  it('focuses the heading when the list empties', async () => {
    const { rerender } = render(<List ids={['a']} />);
    screen.getByText('a').focus();
    removeFocused(rerender, []);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByText('Heading')),
    );
  });

  it('leaves focus alone when it is somewhere else', async () => {
    const { rerender } = render(
      <>
        <button type="button">elsewhere</button>
        <List ids={['a', 'b']} />
      </>,
    );
    screen.getByText('elsewhere').focus();
    rerender(
      <>
        <button type="button">elsewhere</button>
        <List ids={['b']} />
      </>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(screen.getByText('elsewhere'));
  });
});
