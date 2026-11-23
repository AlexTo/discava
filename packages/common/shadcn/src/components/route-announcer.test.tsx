/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageTitle } from '../hooks/use-page-title';
import { RouteAnnouncer } from './route-announcer';

function Child({ title }: { title: string }) {
  usePageTitle(title);
  return <h1>{title}</h1>;
}

function Shell({
  pathname,
  children,
}: {
  pathname: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <RouteAnnouncer containerId="main" pathname={pathname} />
      <div id="main">{children}</div>
    </>
  );
}

const interact = () => fireEvent.keyDown(document.body, { key: 'Tab' });

afterEach(() => vi.restoreAllMocks());

describe('RouteAnnouncer', () => {
  it('focuses nothing on first render', () => {
    render(
      <Shell pathname="/a">
        <h1>A</h1>
      </Shell>,
    );
    expect(document.body).toHaveFocus();
  });

  it('focuses the heading after the pathname changes', () => {
    const { rerender } = render(
      <Shell pathname="/a">
        <h1>A</h1>
      </Shell>,
    );
    interact();
    rerender(
      <Shell pathname="/b">
        <h1>B</h1>
      </Shell>,
    );
    const heading = screen.getByRole('heading', { name: 'B' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('waits for a heading that is added later', async () => {
    const { rerender } = render(<Shell pathname="/a" />);
    interact();
    rerender(<Shell pathname="/b" />);
    expect(document.body).toHaveFocus();
    rerender(
      <Shell pathname="/b">
        <h1>Late</h1>
      </Shell>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Late' })).toHaveFocus(),
    );
  });

  it('focuses the new heading when the old page’s is replaced after focus', async () => {
    const { rerender } = render(
      <Shell pathname="/a">
        <h1>A</h1>
      </Shell>,
    );
    interact();
    // The path changes while the old page still shows.
    rerender(
      <Shell pathname="/b">
        <h1>A</h1>
        <p>old</p>
      </Shell>,
    );
    // The new page replaces it: a different element, so the old one unmounts.
    rerender(
      <Shell pathname="/b">
        <section>
          <h1>B</h1>
        </section>
      </Shell>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'B' })).toHaveFocus(),
    );
  });

  it('leaves focus where the new page moved it', () => {
    // As a lesson opened at a video: the page focuses its target from its
    // own effect, which runs before the announcer's.
    function FocusesTarget() {
      const target = (node: HTMLElement | null) => node?.focus();
      return (
        <>
          <h1>B</h1>
          <article ref={target} tabIndex={-1} aria-label="Target" />
        </>
      );
    }
    const { rerender } = render(
      <Shell pathname="/a">
        <h1>A</h1>
        <a href="/b">To B</a>
      </Shell>,
    );
    const link = screen.getByRole('link', { name: 'To B' });
    fireEvent.pointerDown(link);
    link.focus();
    rerender(
      <Shell pathname="/b">
        <FocusesTarget />
      </Shell>,
    );
    expect(screen.getByRole('article', { name: 'Target' })).toHaveFocus();
  });

  it('focuses the heading when only the link followed took focus', () => {
    const { rerender } = render(
      <Shell pathname="/a">
        <h1>A</h1>
        <a href="/b">To B</a>
      </Shell>,
    );
    const link = screen.getByRole('link', { name: 'To B' });
    fireEvent.pointerDown(link);
    link.focus();
    rerender(
      <Shell pathname="/b">
        <h1>B</h1>
        <a href="/b">To B</a>
      </Shell>,
    );
    expect(screen.getByRole('heading', { name: 'B' })).toHaveFocus();
  });

  it('focuses nothing when the path changes before any key or click', () => {
    const { rerender } = render(
      <Shell pathname="/a">
        <h1>A</h1>
      </Shell>,
    );
    rerender(
      <Shell pathname="/b">
        <h1>B</h1>
      </Shell>,
    );
    expect(document.body).toHaveFocus();
  });

  it('focuses nothing when the pathname is unchanged', () => {
    const { rerender } = render(
      <Shell pathname="/a">
        <h1>A</h1>
      </Shell>,
    );
    rerender(
      <Shell pathname="/a">
        <h1>A</h1>
        <h1>More</h1>
      </Shell>,
    );
    expect(document.body).toHaveFocus();
  });

  it('disconnects its observer on unmount', () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const { rerender, unmount } = render(<Shell pathname="/a" />);
    interact();
    rerender(<Shell pathname="/b" />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('leaves the child-set title alone when the child remounts or keeps its parts', () => {
    const { rerender } = render(
      <Shell pathname="/a">
        <Child key="a" title="Child" />
      </Shell>,
    );
    rerender(
      <Shell pathname="/b">
        <Child key="b" title="Child" />
      </Shell>,
    );
    expect(document.title).toBe('Child · Discava');
    rerender(
      <Shell pathname="/c">
        <Child key="b" title="Child" />
      </Shell>,
    );
    expect(document.title).toBe('Child · Discava');
  });
});
