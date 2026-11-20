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
  const lineRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  // Set while the panel moves focus itself, which isn't the learner reading.
  const movingFocus = React.useRef(false);
  const [following, setFollowing] = React.useState(true);
  // The line last focused: it keeps the tab stop until the learner leaves.
  const [focusedIndex, setFocusedIndex] = React.useState<number>();

  const tabStop =
    focusedIndex !== undefined && focusedIndex < cues.length
      ? focusedIndex
      : Math.max(activeIndex, 0);

  const scrollToActive = React.useCallback(
    (centre: boolean) => {
      const container = scrollRef.current;
      const line = lineRefs.current[activeIndex];
      if (!container || !line) {
        return;
      }
      const top = line.offsetTop;
      const bottom = top + line.offsetHeight;
      if (
        !centre &&
        top >= container.scrollTop &&
        bottom <= container.scrollTop + container.clientHeight
      ) {
        return;
      }
      const target = top - (container.clientHeight - line.offsetHeight) / 2;
      const reduceMotion = window.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({
          top: target,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      } else {
        container.scrollTop = target;
      }
    },
    [activeIndex],
  );

  // Resuming centres the current line; afterwards it only moves when the line leaves the view.
  const wasFollowing = React.useRef(true);
  React.useEffect(() => {
    if (following) {
      scrollToActive(!wasFollowing.current);
    }
    wasFollowing.current = following;
  }, [activeIndex, following]);

  const pause = () => setFollowing(false);
  const resume = () => setFollowing(true);

  const focusLine = (index: number, quietly = false) => {
    movingFocus.current = quietly;
    lineRefs.current[index]?.focus();
    movingFocus.current = false;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const current = lineRefs.current.findIndex(
      (line) => line === document.activeElement,
    );
    if (current < 0) {
      return;
    }
    const last = cues.length - 1;
    const next =
      event.key === 'ArrowDown'
        ? Math.min(current + 1, last)
        : event.key === 'ArrowUp'
          ? Math.max(current - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    focusLine(next);
  };

  const jumpToCurrent = () => {
    resume();
    // The button is about to go away; keep focus in the panel.
    if (activeIndex >= 0) {
      setFocusedIndex(activeIndex);
      focusLine(activeIndex, true);
    }
  };

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
      {!following && (
        <button
          type="button"
          onClick={jumpToCurrent}
          className="border-b px-3 py-1.5 text-left text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          Jump to current line
        </button>
      )}
      <div
        ref={scrollRef}
        onWheel={pause}
        onTouchMove={pause}
        onPointerDown={(event) => {
          // Lines cover the content, so a press on the area itself is its scrollbar.
          if (event.target === event.currentTarget) {
            pause();
          }
        }}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {status === 'failed' ? (
          <p className="p-3 text-sm text-muted-foreground">
            This transcript couldn't be loaded.
          </p>
        ) : cues.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            This transcript is empty.
          </p>
        ) : (
          <ol onKeyDown={onKeyDown}>
            {cues.map((cue, index) => {
              const active = index === activeIndex;
              return (
                <li key={`${cue.start}-${index}`}>
                  <button
                    ref={(node) => {
                      lineRefs.current[index] = node;
                    }}
                    type="button"
                    tabIndex={index === tabStop ? 0 : -1}
                    onFocus={() => {
                      setFocusedIndex(index);
                      if (!movingFocus.current) {
                        pause();
                      }
                    }}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      onChoose(cue);
                      resume();
                    }}
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
