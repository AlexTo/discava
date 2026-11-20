/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
});
