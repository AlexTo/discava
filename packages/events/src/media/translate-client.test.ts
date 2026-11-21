/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CAPTION_LANGUAGES } from '@discava/common-web-utils/caption-languages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSLATE_CHUNK_MAX_BYTES,
  TRANSLATE_LANGUAGE_CODES,
  translateTexts,
  UnsupportedLanguageError,
} from './translate-client.js';

const { send, isLocalDev, ctor } = vi.hoisted(() => ({
  send: vi.fn(),
  isLocalDev: vi.fn(),
  ctor: vi.fn(),
}));

vi.mock('@aws-sdk/client-translate', () => ({
  TranslateClient: vi.fn(function () {
    ctor();
    return { send };
  }),
  TranslateTextCommand: vi.fn(function (input) {
    return { input };
  }),
}));
vi.mock('@discava/common-server-utils/local-dev', () => ({ isLocalDev }));

const input = (texts: string[]) => ({
  texts,
  sourceLanguage: 'en-US',
  targetLanguage: 'es-ES',
});

// Answers each request by upper-casing its lines.
const echoUpper = () =>
  send.mockImplementation(async (command: { input: { Text: string } }) => ({
    TranslatedText: command.input.Text.toUpperCase(),
  }));

beforeEach(() => {
  send.mockReset();
  ctor.mockReset();
  isLocalDev.mockReset().mockReturnValue(false);
});

describe('TRANSLATE_LANGUAGE_CODES', () => {
  it('has a code for every caption language', () => {
    for (const { tag } of CAPTION_LANGUAGES) {
      expect(TRANSLATE_LANGUAGE_CODES[tag]).toBeTruthy();
    }
  });
});

describe('translateTexts', () => {
  it('translates one chunk and splits the answer back into texts', async () => {
    echoUpper();
    const result = await translateTexts(input(['one', 'two']));
    expect(result).toEqual({
      texts: ['ONE', 'TWO'],
      characters: 7,
      requests: 1,
      fallbacks: 0,
    });
    expect(send.mock.calls[0][0].input).toEqual({
      Text: 'one\ntwo',
      SourceLanguageCode: 'en',
      TargetLanguageCode: 'es',
    });
  });

  it('never sends an auto source language', async () => {
    echoUpper();
    await translateTexts(input(['x']));
    expect(send.mock.calls[0][0].input.SourceLanguageCode).not.toBe('auto');
  });

  it('chunks by UTF-8 bytes, not characters, never splitting a cue', async () => {
    echoUpper();
    // 3 bytes per character: 1,000 characters is 3,000 bytes.
    const texts = Array.from(
      { length: 4 },
      (_, i) => `${'あ'.repeat(999)}${i}`,
    );
    const result = await translateTexts({
      ...input(texts),
      sourceLanguage: 'ja-JP',
    });
    expect(result.requests).toBe(4);
    for (const [command] of send.mock.calls) {
      const text: string = command.input.Text;
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(
        TRANSLATE_CHUNK_MAX_BYTES,
      );
      expect(text.split('\n')).toHaveLength(1);
    }
    expect(result.texts).toEqual(texts.map((t) => t.toUpperCase()));
  });

  it('packs several short cues into one request', async () => {
    echoUpper();
    const texts = Array.from({ length: 600 }, (_, i) => `cue number ${i}`);
    const result = await translateTexts(input(texts));
    expect(result.requests).toBeGreaterThan(1);
    expect(result.requests).toBeLessThan(10);
    expect(result.texts).toEqual(texts.map((t) => t.toUpperCase()));
    for (const [command] of send.mock.calls) {
      expect(Buffer.byteLength(command.input.Text)).toBeLessThanOrEqual(
        TRANSLATE_CHUNK_MAX_BYTES,
      );
    }
  });

  it('sends a chunk again one text per request when the line count is wrong', async () => {
    send.mockImplementation(async (command: { input: { Text: string } }) => ({
      TranslatedText: command.input.Text.includes('\n')
        ? command.input.Text.replace('\n', ' ')
        : command.input.Text.toUpperCase(),
    }));
    const result = await translateTexts(input(['a', 'b', 'c']));
    expect(result.texts).toEqual(['A', 'B', 'C']);
    expect(result.fallbacks).toBe(1);
    expect(result.requests).toBe(4);
    expect(result.characters).toBe(5 + 3);
  });

  it('does not send empty texts and returns them empty in place', async () => {
    echoUpper();
    const result = await translateTexts(input(['a', '', 'b']));
    expect(result.texts).toEqual(['A', '', 'B']);
    expect(send.mock.calls[0][0].input.Text).toBe('a\nb');
    expect((await translateTexts(input(['', '']))).requests).toBe(0);
  });

  it('throws UnsupportedLanguageError for a single text over the limit', async () => {
    await expect(
      translateTexts(input(['x'.repeat(TRANSLATE_CHUNK_MAX_BYTES + 1)])),
    ).rejects.toBeInstanceOf(UnsupportedLanguageError);
    expect(send).not.toHaveBeenCalled();
  });

  it('throws UnsupportedLanguageError for an unknown tag', async () => {
    await expect(
      translateTexts({ ...input(['x']), targetLanguage: 'xx-XX' }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageError);
    await expect(
      translateTexts({ ...input(['x']), sourceLanguage: 'xx-XX' }),
    ).rejects.toBeInstanceOf(UnsupportedLanguageError);
  });

  it('turns UnsupportedLanguagePairException into UnsupportedLanguageError', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('pair'), {
        name: 'UnsupportedLanguagePairException',
      }),
    );
    await expect(translateTexts(input(['x']))).rejects.toBeInstanceOf(
      UnsupportedLanguageError,
    );
  });

  it('rethrows a throttling error as it is', async () => {
    const error = Object.assign(new Error('slow down'), {
      name: 'TooManyRequestsException',
    });
    send.mockRejectedValue(error);
    await expect(translateTexts(input(['x']))).rejects.toBe(error);
  });

  it('runs at most four requests at once', async () => {
    let inFlight = 0;
    let peak = 0;
    send.mockImplementation(async (command: { input: { Text: string } }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { TranslatedText: command.input.Text };
    });
    const texts = Array.from(
      { length: 12 },
      (_, i) => `${i}${'x'.repeat(4_000)}`,
    );
    const result = await translateTexts(input(texts));
    expect(result.requests).toBe(12);
    expect(peak).toBe(4);
  });

  it('uses the local stand-in and never builds the SDK client in local dev', async () => {
    isLocalDev.mockReturnValue(true);
    const result = await translateTexts(input(['Hello', '']));
    expect(result.texts).toEqual(['[es-ES] Hello', '']);
    expect(ctor).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
