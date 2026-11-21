/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isWebVtt } from './captions.js';

// Reading and writing WebVTT for caption translation: the cue payloads are
// translated, the ids and timing lines are carried across unchanged.

export interface WebVttCue {
  id?: string;
  /** The whole timing line as written, settings included. */
  timing: string;
  /** The payload lines, joined with \n. */
  text: string;
}

const BOM = '\uFEFF';

/**
 * Parses a WebVTT file into its header and cues, skipping NOTE, STYLE and
 * REGION blocks. Throws on input isWebVtt would refuse.
 */
export const parseWebVtt = (
  text: string,
): { header: string; cues: WebVttCue[] } => {
  if (!isWebVtt(new TextEncoder().encode(text))) {
    throw new Error('Not a WebVTT file');
  }
  const body = (text.startsWith(BOM) ? text.slice(1) : text).replace(
    /\r\n?/g,
    '\n',
  );
  const blocks = body.split(/\n{2,}/);
  const header = (blocks.shift() ?? '').split('\n')[0] ?? 'WEBVTT';
  const cues: WebVttCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((_, i, all) => {
      return !(i === all.length - 1 && all[i] === '');
    });
    if (lines.length === 0 || /^(NOTE|STYLE|REGION)([ \t]|$)/.test(lines[0])) {
      continue;
    }
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1) {
      continue;
    }
    cues.push({
      ...(timingIndex === 1 ? { id: lines[0] } : {}),
      timing: lines[timingIndex],
      text: lines.slice(timingIndex + 1).join('\n'),
    });
  }
  return { header, cues };
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&lrm;': '\u200E',
  '&rlm;': '\u200F',
};

/** A cue's payload as plain text: tags removed, entities decoded, one line. */
export const cueText = (cue: Pick<WebVttCue, 'text'>): string =>
  cue.text
    .replace(/<\/?[a-zA-Z][^>]*>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity])
    .split('\n')
    .join(' ')
    .trim();

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** WEBVTT, then each cue with its id and timing unchanged and its text escaped. */
export const serialiseWebVtt = (cues: readonly WebVttCue[]): string =>
  `WEBVTT\n\n${cues
    .map(
      (cue) =>
        `${cue.id !== undefined ? `${cue.id}\n` : ''}${cue.timing}\n${escapeText(cue.text)}`,
    )
    .join('\n\n')}\n`;
