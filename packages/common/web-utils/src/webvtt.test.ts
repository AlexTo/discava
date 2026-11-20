/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { activeCueIndex, parseWebVtt, spokenTime } from './webvtt';

const SAMPLE = `WEBVTT

00:00:01.000 --> 00:00:04.000
Welcome to the lesson on gradient

00:00:04.000 --> 00:00:07.500
descent and how it finds a minimum.

00:00:09.000 --> 00:00:12.000
<v Ana>We start with a random point &amp; a step size.
`;

describe('parseWebVtt', () => {
  it('parses the sample file', () => {
    expect(parseWebVtt(SAMPLE)).toEqual([
      { start: 1, end: 4, text: 'Welcome to the lesson on gradient' },
      { start: 4, end: 7.5, text: 'descent and how it finds a minimum.' },
      {
        start: 9,
        end: 12,
        text: 'We start with a random point & a step size.',
      },
    ]);
  });

  it('ignores a byte order mark and CRLF line endings', () => {
    const text = `﻿${SAMPLE.replace(/\n/g, '\r\n')}`;
    expect(parseWebVtt(text)).toEqual(parseWebVtt(SAMPLE));
  });

  it('skips cue identifiers', () => {
    const cues = parseWebVtt('WEBVTT\n\nintro\n00:01.000 --> 00:02.000\nHi\n');
    expect(cues).toEqual([{ start: 1, end: 2, text: 'Hi' }]);
  });

  it('joins a two-line cue with a space', () => {
    const cues = parseWebVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nOne\ntwo\n');
    expect(cues[0].text).toBe('One two');
  });

  it('ignores cue settings', () => {
    const cues = parseWebVtt(
      'WEBVTT\n\n00:01.000 --> 01:02:03.500 align:start line:0%\nHi\n',
    );
    expect(cues).toEqual([{ start: 1, end: 3723.5, text: 'Hi' }]);
  });

  it('skips NOTE, STYLE and REGION blocks', () => {
    const text = `WEBVTT

STYLE
::cue { color: red }

REGION
id:r

NOTE
00:00:00.000 --> 00:00:01.000
not a cue

00:00:02.000 --> 00:00:03.000
Real

NOTE a comment

00:00:04.000 --> 00:00:05.000
Also real
`;
    expect(parseWebVtt(text).map((c) => c.text)).toEqual(['Real', 'Also real']);
  });

  it('drops tags, decodes entities and collapses whitespace', () => {
    const text =
      'WEBVTT\n\n00:01.000 --> 00:02.000\n<c.loud>a</c>  <i>b</i> <00:00:01.500>&lt;c&gt;&nbsp;&lrm;d\n';
    expect(parseWebVtt(text)[0].text).toBe('a b <c> d');
  });

  it('drops cues with no text', () => {
    expect(parseWebVtt('WEBVTT\n\n00:01.000 --> 00:02.000\n<i></i>\n')).toEqual(
      [],
    );
  });

  it('sorts overlapping cues by start', () => {
    const text =
      'WEBVTT\n\n00:05.000 --> 00:09.000\nlate\n\n00:01.000 --> 00:07.000\nearly\n';
    expect(parseWebVtt(text).map((c) => c.text)).toEqual(['early', 'late']);
  });

  it.each(['', 'WEBVTT\n', 'not a caption file'])('gives [] for %j', (text) => {
    expect(parseWebVtt(text)).toEqual([]);
  });
});

describe('activeCueIndex', () => {
  const cues = parseWebVtt(SAMPLE);

  it('is -1 before the first cue', () => {
    expect(activeCueIndex(cues, 0.5)).toBe(-1);
    expect(activeCueIndex([], 3)).toBe(-1);
  });

  it('finds the cue being spoken', () => {
    expect(activeCueIndex(cues, 1)).toBe(0);
    expect(activeCueIndex(cues, 5)).toBe(1);
  });

  it('keeps the earlier cue in a gap', () => {
    expect(activeCueIndex(cues, 8)).toBe(1);
  });

  it('keeps the last cue after the end', () => {
    expect(activeCueIndex(cues, 500)).toBe(2);
  });
});

describe('spokenTime', () => {
  it.each([
    [40, '40 seconds'],
    [1, '1 second'],
    [760, '12 minutes 40 seconds'],
    [3725, '1 hour 2 minutes 5 seconds'],
    [60, '1 minute'],
    [0, '0 seconds'],
  ])('%d is %s', (input, expected) => {
    expect(spokenTime(input)).toBe(expected);
  });
});
