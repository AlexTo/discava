/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TranscriptCue } from '@discava/common-web-utils/webvtt';
import { describe, expect, it } from 'vitest';
import {
  buildPassages,
  PASSAGE_CHARACTERS,
  PASSAGE_SECONDS,
  toTranscriptDocuments,
} from './transcript-document.js';

// Cues of `length` seconds, back to back, each saying "word<n>".
const cuesOf = (count: number, length = 5): TranscriptCue[] =>
  Array.from({ length: count }, (_, index) => ({
    start: index * length,
    end: (index + 1) * length,
    text: `word${index}`,
  }));

describe('buildPassages', () => {
  it('gives no passages for no cues, or only empty ones', () => {
    expect(buildPassages([])).toEqual([]);
    expect(buildPassages([{ start: 0, end: 1, text: '  ' }])).toEqual([]);
  });

  it('gives one passage for a track that fits', () => {
    const passages = buildPassages(cuesOf(3));
    expect(passages).toEqual([
      {
        seq: 0,
        startSeconds: 0,
        endSeconds: 15,
        text: 'word0 word1 word2',
        cues: [
          { s: 0, o: 0 },
          { s: 5, o: 6 },
          { s: 10, o: 12 },
        ],
      },
    ]);
  });

  it('splits 90 seconds into passages within 30 s that overlap by one cue', () => {
    const cues = cuesOf(18);
    const passages = buildPassages(cues);

    expect(passages.length).toBeGreaterThan(1);
    passages.forEach((passage, index) => {
      expect(passage.seq).toBe(index);
      expect(passage.endSeconds - passage.startSeconds).toBeLessThanOrEqual(
        PASSAGE_SECONDS,
      );
      if (index > 0) {
        const previous = passages[index - 1];
        const shared = passage.text
          .split(' ')
          .filter((word) => previous.text.split(' ').includes(word));
        expect(shared).toEqual([previous.text.split(' ').at(-1)]);
      }
    });
    expect(passages.at(-1)?.text.endsWith('word17')).toBe(true);
    expect(passages[0].text.startsWith('word0 ')).toBe(true);
  });

  it('closes a passage at the 600-character limit', () => {
    const word = 'x'.repeat(199);
    const cues = [0, 1, 2, 3].map((index) => ({
      start: index,
      end: index + 1,
      text: word,
    }));
    const passages = buildPassages(cues);

    // 199 * 3 + 2 spaces = 599: three fit, a fourth does not.
    expect(passages[0].text).toHaveLength(3 * 199 + 2);
    expect(passages[0].text.length).toBeLessThanOrEqual(PASSAGE_CHARACTERS);
    expect(passages[1].cues).toHaveLength(2);
  });

  it('makes a cue over the limit a passage on its own, cut at 2,000 characters', () => {
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: 'before' },
      { start: 1, end: 2, text: 'y'.repeat(700) },
      { start: 2, end: 3, text: 'after' },
      { start: 3, end: 4, text: 'y'.repeat(2500) },
    ];
    const passages = buildPassages(cues);

    const long = passages.find((passage) => passage.text.startsWith('y'));
    expect(long?.text).toHaveLength(700);
    expect(long?.cues).toEqual([{ s: 1, o: 0 }]);
    expect(passages.at(-1)?.text).toHaveLength(2000);
    expect(passages.map((passage) => passage.seq)).toEqual(
      passages.map((_, index) => index),
    );
  });

  it('puts every cue in a passage, even beside an oversized one', () => {
    const cues: TranscriptCue[] = [
      { start: 0, end: 1, text: 'a' },
      { start: 1, end: 2, text: 'z'.repeat(650) },
      { start: 2, end: 3, text: 'b' },
      { start: 3, end: 4, text: 'c' },
    ];
    const text = buildPassages(cues)
      .map((passage) => passage.text)
      .join(' ');
    for (const word of ['a', 'b', 'c']) {
      expect(text.split(' ')).toContain(word);
    }
  });

  it('records each cue offset as where its text starts in the passage text', () => {
    const cues = cuesOf(18).map((cue, index) => ({
      ...cue,
      text: `${cue.text} ${'ab'.repeat(index % 4)}`.trim(),
    }));
    for (const passage of buildPassages(cues)) {
      passage.cues.forEach((cue) => {
        const source = cues.find((candidate) => candidate.start === cue.s);
        expect(
          passage.text.slice(cue.o, cue.o + (source?.text.length ?? 0)),
        ).toBe(source?.text);
      });
    }
  });

  it('keeps two words in neighbouring cues together in at least one passage', () => {
    const cues = cuesOf(40, 4);
    const passages = buildPassages(cues);
    for (let index = 0; index < cues.length - 1; index++) {
      const pair = [cues[index].text, cues[index + 1].text];
      expect(
        passages.some((passage) =>
          pair.every((word) => passage.text.split(' ').includes(word)),
        ),
      ).toBe(true);
    }
  });

  it('removes the highlight characters and collapses whitespace', () => {
    const [passage] = buildPassages([{ start: 0, end: 1, text: 'ab  c' }]);
    expect(passage.text).toBe('ab c');
  });
});

describe('toTranscriptDocuments', () => {
  const item = {
    courseId: 'c1',
    moduleId: 'm1',
    lessonId: 'l1',
    contentItemId: 'i1',
  };
  const now = new Date('2026-01-02T03:04:05.000Z');

  it('writes a validated document per passage under the item, track and seq', () => {
    const documents = toTranscriptDocuments({
      item,
      versionId: 'v1',
      track: {
        trackId: 't2',
        language: 'es',
        source: 'uploaded',
        isDefault: false,
      },
      trackLanguages: ['en', 'es'],
      cues: cuesOf(18),
      now,
    });

    expect(documents.length).toBeGreaterThan(1);
    expect(documents.map((entry) => entry.id)).toEqual(
      documents.map((_, index) => `i1.t2.${String(index).padStart(5, '0')}`),
    );
    expect(documents[0].document).toMatchObject({
      ...item,
      versionId: 'v1',
      trackId: 't2',
      language: 'es',
      source: 'uploaded',
      isDefault: false,
      trackLanguages: ['en', 'es'],
      seq: 0,
      indexedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('gives nothing for a track without cues', () => {
    expect(
      toTranscriptDocuments({
        item,
        versionId: 'v1',
        track: {
          trackId: 't',
          language: 'en',
          source: 'auto',
          isDefault: true,
        },
        trackLanguages: ['en'],
        cues: [],
        now,
      }),
    ).toEqual([]);
  });
});
