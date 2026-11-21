/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscriptPanel } from './transcript-panel';

const cues = [
  { start: 1, end: 4, text: 'Welcome to the lesson' },
  { start: 65, end: 70, text: 'Now a <b>bold</b> idea' },
  { start: 760, end: 765, text: 'Last line' },
];

const renderPanel = (
  props: Partial<React.ComponentProps<typeof TranscriptPanel>> = {},
) =>
  render(
    <TranscriptPanel
      id="panel"
      cues={cues}
      activeIndex={-1}
      languageLabel="English"
      status="ready"
      onChoose={() => {}}
      {...props}
    />,
  );

describe('TranscriptPanel', () => {
  it('lists every cue with its time', () => {
    renderPanel();
    const lines = screen.getAllByRole('button');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('0:01');
    expect(lines[0]).toHaveTextContent('1 second');
    expect(lines[2]).toHaveTextContent('12:40');
    expect(lines[2]).toHaveTextContent('12 minutes 40 seconds');
  });

  it('names the region with the language', () => {
    renderPanel({ languageLabel: 'Spanish' });
    expect(
      screen.getByRole('region', { name: 'Transcript (Spanish)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Transcript' }),
    ).toBeInTheDocument();
  });

  it('marks only the active line as current', () => {
    renderPanel({ activeIndex: 1 });
    const lines = screen.getAllByRole('button');
    expect(lines.map((l) => l.getAttribute('aria-current'))).toEqual([
      null,
      'true',
      null,
    ]);
  });

  it('marks no line before the first cue', () => {
    renderPanel({ activeIndex: -1 });
    for (const line of screen.getAllByRole('button')) {
      expect(line).not.toHaveAttribute('aria-current');
    }
  });

  it('reports the chosen cue', async () => {
    const onChoose = vi.fn();
    renderPanel({ onChoose });
    await userEvent.click(screen.getByRole('button', { name: /Last line/ }));
    expect(onChoose).toHaveBeenCalledWith(cues[2]);
  });

  it('says when the transcript failed to load', () => {
    renderPanel({ status: 'failed', cues: [] });
    expect(
      screen.getByText("This transcript couldn't be loaded."),
    ).toBeInTheDocument();
  });

  it('says when the transcript is empty', () => {
    renderPanel({ cues: [] });
    expect(screen.getByText('This transcript is empty.')).toBeInTheDocument();
  });

  it('shows markup in cue text literally', () => {
    renderPanel();
    expect(screen.getByText(/Now a <b>bold<\/b> idea/)).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  describe('keyboard', () => {
    const lines = () =>
      screen
        .getAllByRole('listitem')
        .map((li) => li.querySelector('button') as HTMLButtonElement);

    it('has exactly one tab stop, on the first line before any cue', () => {
      renderPanel();
      expect(lines().map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    });

    it('puts the tab stop on the active line', () => {
      renderPanel({ activeIndex: 1 });
      expect(lines().map((l) => l.tabIndex)).toEqual([-1, 0, -1]);
    });

    it('keeps the tab stop on the last focused line', async () => {
      renderPanel({ activeIndex: 1 });
      act(() => lines()[2].focus());
      expect(lines().map((l) => l.tabIndex)).toEqual([-1, -1, 0]);
    });

    it('moves focus with Down, Up, Home and End', async () => {
      renderPanel();
      act(() => lines()[0].focus());
      await userEvent.keyboard('{ArrowDown}');
      expect(lines()[1]).toHaveFocus();
      await userEvent.keyboard('{End}');
      expect(lines()[2]).toHaveFocus();
      await userEvent.keyboard('{ArrowUp}');
      expect(lines()[1]).toHaveFocus();
      await userEvent.keyboard('{Home}');
      expect(lines()[0]).toHaveFocus();
    });

    it('stays on the last line at Down and on the first at Up', async () => {
      renderPanel();
      act(() => lines()[2].focus());
      await userEvent.keyboard('{ArrowDown}');
      expect(lines()[2]).toHaveFocus();
      act(() => lines()[0].focus());
      await userEvent.keyboard('{ArrowUp}');
      expect(lines()[0]).toHaveFocus();
    });

    it('prevents the default of the keys it handles', () => {
      renderPanel();
      act(() => lines()[0].focus());
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
        });
        act(() => {
          lines()[0].dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(true);
      }
    });

    it('activates with Enter and Space and keeps focus on the line', async () => {
      const onChoose = vi.fn();
      renderPanel({ onChoose });
      act(() => lines()[1].focus());
      await userEvent.keyboard('{Enter}');
      expect(onChoose).toHaveBeenLastCalledWith(cues[1]);
      expect(lines()[1]).toHaveFocus();
      await userEvent.keyboard(' ');
      expect(onChoose).toHaveBeenCalledTimes(2);
      expect(lines()[1]).toHaveFocus();
    });
  });

  describe('following', () => {
    const scrollTo = vi.fn();
    const original = Element.prototype.scrollTo;
    const matchMedia = window.matchMedia;

    const prepare = (reduceMotion = false) => {
      Element.prototype.scrollTo = scrollTo;
      window.matchMedia = vi.fn((query: string) => ({
        matches: reduceMotion && query.includes('prefers-reduced-motion'),
      })) as unknown as typeof window.matchMedia;
    };

    afterEach(() => {
      scrollTo.mockReset();
      Element.prototype.scrollTo = original;
      window.matchMedia = matchMedia;
    });

    const scrollArea = () =>
      document.querySelector('.overflow-y-auto') as HTMLElement;
    const jump = () =>
      screen.queryByRole('button', { name: 'Jump to current line' });

    it('pauses on wheel, and a later active line does not scroll', () => {
      prepare();
      const { rerender } = renderPanel({ activeIndex: 0 });
      expect(jump()).toBeNull();
      fireEvent.wheel(scrollArea());
      expect(jump()).toBeInTheDocument();
      scrollTo.mockClear();
      rerender(
        <TranscriptPanel
          id="panel"
          cues={cues}
          activeIndex={2}
          languageLabel="English"
          status="ready"
          onChoose={() => {}}
        />,
      );
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('pauses on touchmove, on focus in a line and on a press on the scrollbar', () => {
      for (const pauseIt of [
        () => fireEvent.touchMove(scrollArea()),
        () =>
          act(() =>
            screen.getAllByRole('listitem')[1].querySelector('button')?.focus(),
          ),
        () => fireEvent.pointerDown(scrollArea()),
      ]) {
        const { unmount } = renderPanel();
        pauseIt();
        expect(jump()).toBeInTheDocument();
        unmount();
      }
    });

    it('does not pause on a press on a line', () => {
      renderPanel();
      fireEvent.pointerDown(screen.getAllByRole('button')[0]);
      expect(jump()).toBeNull();
    });

    it('resumes and centres the current line from the button', async () => {
      prepare();
      renderPanel({ activeIndex: 1 });
      fireEvent.wheel(scrollArea());
      scrollTo.mockClear();
      await userEvent.click(jump() as HTMLElement);
      expect(jump()).toBeNull();
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      );
    });

    it('resumes when a line is chosen', async () => {
      renderPanel();
      fireEvent.wheel(scrollArea());
      await userEvent.click(screen.getByRole('button', { name: /Last line/ }));
      expect(jump()).toBeNull();
    });

    it('does not animate with reduced motion', async () => {
      prepare(true);
      renderPanel({ activeIndex: 1 });
      fireEvent.wheel(scrollArea());
      await userEvent.click(jump() as HTMLElement);
      expect(scrollTo).toHaveBeenCalled();
      for (const [options] of scrollTo.mock.calls) {
        expect(options.behavior).not.toBe('smooth');
      }
    });

    it('has no live region', () => {
      renderPanel({ activeIndex: 1 });
      fireEvent.wheel(scrollArea());
      expect(document.querySelector('[aria-live], [role="status"]')).toBeNull();
    });
  });
});
