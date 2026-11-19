/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { highlightTitle } from './title-highlight';

const TITLE = 'Python for Data Analysis';

describe('highlightTitle', () => {
  it('marks the typed start of a word', () => {
    expect(highlightTitle(TITLE, 'pyth')).toEqual([
      { text: 'Pyth', match: true },
      { text: 'on for Data Analysis', match: false },
    ]);
  });

  it('marks each typed word, in either order', () => {
    const expected = [
      { text: 'Py', match: true },
      { text: 'thon for ', match: false },
      { text: 'Data', match: true },
      { text: ' Analysis', match: false },
    ];

    expect(highlightTitle(TITLE, 'data py')).toEqual(expected);
    expect(highlightTitle(TITLE, 'py data')).toEqual(expected);
  });

  it('ignores accents and case', () => {
    expect(highlightTitle('Cafe Culture', 'café')).toEqual([
      { text: 'Cafe', match: true },
      { text: ' Culture', match: false },
    ]);
    expect(highlightTitle('Café Culture', 'CAFE')).toEqual([
      { text: 'Café', match: true },
      { text: ' Culture', match: false },
    ]);
  });

  it('keeps punctuation in the title', () => {
    const parts = highlightTitle('C++ & Rust: a (fast) start', 'rus fa');

    expect(parts).toEqual([
      { text: 'C++ & ', match: false },
      { text: 'Rus', match: true },
      { text: 't: a (', match: false },
      { text: 'fa', match: true },
      { text: 'st) start', match: false },
    ]);
  });

  it('marks nothing when nothing matches', () => {
    expect(highlightTitle(TITLE, 'zzz')).toEqual([
      { text: TITLE, match: false },
    ]);
  });

  it('marks nothing for empty typed text', () => {
    expect(highlightTitle(TITLE, '  ')).toEqual([
      { text: TITLE, match: false },
    ]);
  });

  it('does not mark the middle of a word', () => {
    expect(highlightTitle(TITLE, 'ata')).toEqual([
      { text: TITLE, match: false },
    ]);
  });

  it.each([
    [TITLE, 'data py'],
    ['  Odd -- title!! ', 'odd'],
    ['', 'abc'],
  ])('always joins back to the title (%j, %j)', (title, typed) => {
    expect(
      highlightTitle(title, typed)
        .map((part) => part.text)
        .join(''),
    ).toBe(title);
  });
});
