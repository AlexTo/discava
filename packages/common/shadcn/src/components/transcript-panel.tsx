/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
'use client';

import {
  spokenTime,
  type TranscriptCue,
} from '@discava/common-web-utils/webvtt';
import { cn } from 'cn';
import * as React from 'react';
import { formatTime } from './video-controls';

/**
 * The lines of a video's caption track, with the one being spoken marked.
 * Choosing a line reports its cue; the panel doesn't know the video. It
 * scrolls inside itself to keep the current line in view, by setting its own
 * `scrollTop`: the page never scrolls and focus never moves. Cue text is
 * shown as text, never as HTML.
 */
export function TranscriptPanel({
  id,
  cues,
  activeIndex,
  languageLabel,
  status,
  onChoose,
  className,
}: {
  id: string;
  cues: TranscriptCue[];
  // The line being spoken, or -1 before the first.
  activeIndex: number;
  languageLabel: string;
  status: 'ready' | 'failed';
  onChoose: (cue: TranscriptCue) => void;
  className?: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the current line moves the scroll
  React.useEffect(() => {
    const container = scrollRef.current;
    const line = activeRef.current;
    if (!container || !line) {
      return;
    }
    const top = line.offsetTop;
    const bottom = top + line.offsetHeight;
    if (
      top < container.scrollTop ||
      bottom > container.scrollTop + container.clientHeight
    ) {
      container.scrollTop =
        top - (container.clientHeight - line.offsetHeight) / 2;
    }
  }, [activeIndex]);

  return (
    <section
      id={id}
      data-slot="transcript-panel"
      aria-label={`Transcript (${languageLabel})`}
      className={cn(
        'flex min-h-0 flex-col rounded-md border bg-card',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Transcript</h3>
        <span className="text-xs text-muted-foreground">{languageLabel}</span>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        {status === 'failed' ? (
          <p className="p-3 text-sm text-muted-foreground">
            This transcript couldn't be loaded.
          </p>
        ) : cues.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            This transcript is empty.
          </p>
        ) : (
          <ol>
            {cues.map((cue, index) => {
              const active = index === activeIndex;
              return (
                <li key={`${cue.start}-${index}`}>
                  <button
                    ref={active ? activeRef : undefined}
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onChoose(cue)}
                    className={cn(
                      'flex w-full gap-3 border-l-2 border-transparent px-3 py-1.5 text-left text-sm break-words hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                      active && 'border-primary bg-accent/50 font-semibold',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="shrink-0 tabular-nums text-muted-foreground"
                    >
                      {formatTime(cue.start)}
                    </span>
                    <span className="sr-only">{spokenTime(cue.start)}</span>
                    {cue.text}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
