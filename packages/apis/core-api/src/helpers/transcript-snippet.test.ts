/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { MATCH_END as E, MATCH_START as S } from './transcript-query.js';
import { transcriptSnippet } from './transcript-snippet.js';

const joined = (parts: { text: string }[]) =>
  parts.map((part) => part.text).join('');
const plain = (tagged: string) => tagged.replaceAll(S, '').replaceAll(E, '');

describe('transcriptSnippet', () => {
  const text = `Hello there. ${S}Gradient${E} descent is next. We stop.`;
  const cues = [
    { s: 0, o: 0 },
    { s: 4.7, o: 13 },
    { s: 9, o: 36 },
  ];

  it('starts at the cue holding the match, floored', () => {
    const result = transcriptSnippet(text, cues);
    expect(result.startSeconds).toBe(4);
    expect(result.snippet).toEqual([
      { text: 'Hello there. ', match: false },
      { text: 'Gradient', match: true },
      { text: ' descent is next. We stop.', match: false },
    ]);
  });

  it('starts at the first cue for a match at offset 0', () => {
    const result = transcriptSnippet(`${S}Hello${E} there.`, cues);
    expect(result.startSeconds).toBe(0);
    expect(result.snippet[0]).toEqual({ text: 'Hello', match: true });
  });

  it('marks every match in the window', () => {
    const { snippet } = transcriptSnippet(
      `${S}go${E} and ${S}go${E} again`,
      cues,
    );
    expect(snippet.filter((part) => part.match)).toHaveLength(2);
  });

  it('cuts a long passage on both sides at word boundaries', () => {
    const word = 'word ';
    const tagged = `${word.repeat(100)}${S}target${E} ${word.repeat(100)}`;
    const { snippet } = transcriptSnippet(tagged, [{ s: 0, o: 0 }]);
    const text = joined(snippet);
    expect(snippet[0]?.text).toBe('…');
    expect(snippet.at(-1)?.text).toBe('…');
    expect(text.length).toBeLessThanOrEqual(244);
    expect(snippet.some((part) => part.match && part.text === 'target')).toBe(
      true,
    );
    expect(plain(tagged)).toContain(text.replaceAll('…', ''));
    expect(text.replaceAll('…', '')).toMatch(/^word .*word\s?$/);
  });

  it('gives the first cue and one unmarked part when nothing is tagged', () => {
    expect(transcriptSnippet('No tags here', cues)).toEqual({
      startSeconds: 0,
      snippet: [{ text: 'No tags here', match: false }],
    });
  });

  it('never leaves a tag character in a part', () => {
    const { snippet } = transcriptSnippet(text, cues);
    for (const part of snippet) {
      expect(part.text).not.toMatch(/[]/);
    }
  });
});
