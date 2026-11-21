/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { UnsupportedLanguageError } from '../media/translate-client.js';
import { translateLocally } from './translator.js';

const input = (texts: string[]) => ({
  texts,
  sourceLanguage: 'en-US',
  targetLanguage: 'es-ES',
});

describe('translateLocally', () => {
  it('prefixes each non-empty text with the target language', () => {
    expect(translateLocally(input(['Hello', 'World']))).toEqual([
      '[es-ES] Hello',
      '[es-ES] World',
    ]);
  });

  it('leaves an empty text empty', () => {
    expect(translateLocally(input(['a', '', 'b']))).toEqual([
      '[es-ES] a',
      '',
      '[es-ES] b',
    ]);
  });

  it.each(['[[fail-translation]]', '[[fail-translation:es-ES]]'])(
    'throws UnsupportedLanguageError for %s',
    (marker) => {
      expect(() => translateLocally(input(['ok', `bad ${marker}`]))).toThrow(
        UnsupportedLanguageError,
      );
    },
  );

  it('does not throw for a marker naming another language', () => {
    expect(translateLocally(input(['x [[fail-translation:fr-FR]]']))).toEqual([
      '[es-ES] x [[fail-translation:fr-FR]]',
    ]);
  });
});
