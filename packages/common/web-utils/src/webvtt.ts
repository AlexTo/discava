/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TranscriptCue {
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
  text: string;
}

const TIMING =
  /^(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{3})(?:\s|$)/;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
};

const seconds = (h: string | undefined, m: string, s: string, ms: string) =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

function cleanText(lines: string[]): string {
  return lines
    .join(' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity])
    .replace(/[]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The cues of a WebVTT file, sorted by start. Skips the header, NOTE, STYLE
 * and REGION blocks and cue identifiers; drops tags and empty cues. Never
 * throws: a file with no cue gives an empty list.
 */
export function parseWebVtt(text: string): TranscriptCue[] {
  const blocks = text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  const cues: TranscriptCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingAt = lines.findIndex((line) => TIMING.test(line));
    if (timingAt === -1 || timingAt > 1) {
      continue;
    }
    // A cue identifier may be the one line before the timing, never a NOTE.
    if (timingAt === 1 && /^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) {
      continue;
    }
    const match = TIMING.exec(lines[timingAt]);
    if (!match) {
      continue;
    }
    const cueText = cleanText(lines.slice(timingAt + 1));
    if (cueText === '') {
      continue;
    }
    cues.push({
      start: seconds(match[1], match[2], match[3], match[4]),
      end: seconds(match[5], match[6], match[7], match[8]),
      text: cueText,
    });
  }

  // Array.sort is stable, so cues starting together keep file order.
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * The index of the last cue whose start is at or before `time`, or -1 before
 * the first. `cues` must be sorted by start.
 */
export function activeCueIndex(cues: TranscriptCue[], time: number): number {
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** A time in words for screen readers: "12 minutes 40 seconds". */
export function spokenTime(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(unit(hours, 'hour'));
  }
  if (minutes > 0) {
    parts.push(unit(minutes, 'minute'));
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(unit(secs, 'second'));
  }
  return parts.join(' ');
}
