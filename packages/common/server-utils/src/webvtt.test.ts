/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isWebVtt } from './captions.js';
import { cueText, parseWebVtt, serialiseWebVtt } from './webvtt.js';

const transcribe = `WEBVTT

00:00:00.040 --> 00:00:02.100
Hello and welcome.

00:00:02.200 --> 00:00:04.000
To the course.
`;

const rich = `\uFEFFWEBVTT - a title

NOTE this is a note
spanning lines

STYLE
::cue { color: red }

REGION
id:r1

intro
00:00:01.000 --> 00:00:02.000 align:start position:10%
<v Alice>Hello <i>there</i> &amp; welcome</v>
second line

2
00:00:03.000 --> 00:00:04.000

`;

const SAMPLES = [
  transcribe,
  rich,
  rich.replace(/\n/g, '\r\n'),
  `WEBVTT

00:00:00.000 --> 00:00:01.000
a --> b <script>x</script>
`,
];

describe('parseWebVtt', () => {
  it('parses Transcribe output', () => {
    const { header, cues } = parseWebVtt(transcribe);
    expect(header).toBe('WEBVTT');
    expect(cues).toEqual([
      { timing: '00:00:00.040 --> 00:00:02.100', text: 'Hello and welcome.' },
      { timing: '00:00:02.200 --> 00:00:04.000', text: 'To the course.' },
    ]);
  });

  it('keeps ids and settings, skips notes and styles, joins lines', () => {
    const { cues } = parseWebVtt(rich);
    expect(cues).toEqual([
      {
        id: 'intro',
        timing: '00:00:01.000 --> 00:00:02.000 align:start position:10%',
        text: '<v Alice>Hello <i>there</i> &amp; welcome</v>\nsecond line',
      },
      { id: '2', timing: '00:00:03.000 --> 00:00:04.000', text: '' },
    ]);
  });

  it('accepts a BOM and CRLF line ends', () => {
    const crlf = parseWebVtt(rich.replace(/\n/g, '\r\n'));
    expect(crlf.cues).toEqual(parseWebVtt(rich).cues);
  });

  it('throws on input isWebVtt refuses', () => {
    expect(() => parseWebVtt('hello')).toThrow();
    expect(() => parseWebVtt('WEBVTT\n\nno cues')).toThrow();
  });
});

describe('cueText', () => {
  it('strips tags and timestamps, decodes entities, joins lines', () => {
    expect(
      cueText({
        text: '<v Bob>a &lt;b&gt; &amp; c</v>\n<c.x>d</c> <00:00:01.500>e&nbsp;f&lrm;&rlm;',
      }),
    ).toBe('a <b> & c d e f\u200E\u200F');
  });

  it('is empty for an empty cue', () => {
    expect(cueText({ text: '' })).toBe('');
  });
});

describe('serialiseWebVtt', () => {
  it('escapes &, < and > in the text', () => {
    const out = serialiseWebVtt([
      { timing: '00:00:00.000 --> 00:00:01.000', text: 'a --> b <script>&' },
    ]);
    expect(out).toContain('a --> b'.replace('>', '&gt;'));
    expect(out).toContain('&lt;script&gt;&amp;');
    expect(out).not.toContain('<script>');
  });

  it.each(SAMPLES.map((s, i) => [i, s] as const))(
    'round-trips sample %i with the same timings',
    (_i, sample) => {
      const parsed = parseWebVtt(sample);
      const out = serialiseWebVtt(parsed.cues);
      const again = parseWebVtt(out);
      expect(again.cues).toHaveLength(parsed.cues.length);
      expect(again.cues.map((c) => c.timing)).toEqual(
        parsed.cues.map((c) => c.timing),
      );
      expect(isWebVtt(new TextEncoder().encode(out))).toBe(true);
    },
  );
});
