/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { MATCH_END, MATCH_START } from './transcript-query.js';

export interface ISnippetPart {
  text: string;
  match: boolean;
}

// The window around the first match, in characters.
const MAX_SNIPPET = 240;
const ELLIPSIS = '…';

// Plain text and the matched [start, end) ranges of a tagged passage.
const untag = (highlighted: string) => {
  let text = '';
  const ranges: [number, number][] = [];
  let open = -1;
  for (const char of highlighted) {
    if (char === MATCH_START) {
      open = text.length;
    } else if (char === MATCH_END) {
      if (open >= 0 && text.length > open) {
        ranges.push([open, text.length]);
      }
      open = -1;
    } else {
      text += char;
    }
  }
  return { text, ranges };
};

// Moves `index` to the nearest word start at or after it (or the text's end).
const wordStartAtOrAfter = (text: string, index: number) => {
  let i = index;
  while (i < text.length && i > 0 && !/\s/.test(text[i - 1]!)) {
    i++;
  }
  return i;
};

// Moves `index` back to the nearest word end at or before it.
const wordEndAtOrBefore = (text: string, index: number) => {
  let i = index;
  while (i > 0 && i < text.length && !/\s/.test(text[i]!)) {
    i--;
  }
  return i;
};

/**
 * The moment a highlighted passage hit points at, and a short marked snippet
 * of it. `cues` is the passage's cue list: `s` the cue's start in seconds,
 * `o` its offset in the text. The start is that of the last cue beginning at
 * or before the first match.
 */
export const transcriptSnippet = (
  highlighted: string,
  cues: { s: number; o: number }[],
): { startSeconds: number; snippet: ISnippetPart[] } => {
  const { text, ranges } = untag(highlighted);
  const first = ranges[0];
  if (!first) {
    return {
      startSeconds: Math.floor(cues[0]?.s ?? 0),
      snippet: [{ text: text.slice(0, MAX_SNIPPET), match: false }],
    };
  }

  const cue = [...cues].reverse().find(({ o }) => o <= first[0]);
  const startSeconds = Math.floor(cue?.s ?? cues[0]?.s ?? 0);

  let from = 0;
  let to = text.length;
  if (text.length > MAX_SNIPPET) {
    const matchEnd = Math.min(first[1], first[0] + MAX_SNIPPET);
    const spare = Math.max(0, MAX_SNIPPET - (matchEnd - first[0]));
    from = Math.max(0, first[0] - Math.floor(spare / 2));
    to = Math.min(text.length, from + MAX_SNIPPET);
    from = Math.max(0, to - MAX_SNIPPET);
    // Never cut inside the first match.
    from = Math.min(from, first[0]);
    from = from > 0 ? wordStartAtOrAfter(text, from) : 0;
    from = Math.min(from, first[0]);
    to = to < text.length ? wordEndAtOrBefore(text, to) : text.length;
    to = Math.max(to, Math.min(first[1], from + MAX_SNIPPET));
  }

  const parts: ISnippetPart[] = [];
  const push = (value: string, match: boolean) => {
    if (value) {
      parts.push({ text: value, match });
    }
  };
  let at = from;
  for (const [start, end] of ranges) {
    if (end <= from || start >= to) {
      continue;
    }
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    push(text.slice(at, s), false);
    push(text.slice(s, e), true);
    at = e;
  }
  push(text.slice(at, to), false);

  if (from > 0) {
    parts.unshift({ text: ELLIPSIS, match: false });
  }
  if (to < text.length) {
    parts.push({ text: ELLIPSIS, match: false });
  }
  return { startSeconds, snippet: parts };
};
