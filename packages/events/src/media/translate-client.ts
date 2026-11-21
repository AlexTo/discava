/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  TranslateClient,
  TranslateTextCommand,
} from '@aws-sdk/client-translate';
import { isLocalDev } from '@discava/common-server-utils/local-dev';
import { translateLocally } from '../local/translator.js';

/** Amazon Translate's code for each caption language tag. */
export const TRANSLATE_LANGUAGE_CODES: Readonly<Record<string, string>> = {
  'en-US': 'en',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'pt-BR': 'pt',
  'ja-JP': 'ja',
  'zh-CN': 'zh',
  'hi-IN': 'hi',
  'ar-SA': 'ar',
  'vi-VN': 'vi',
};

// The service documents two limits for TranslateText (10,000 bytes in the API
// reference, 5,000 bytes in the quotas page); the smaller is used so a request
// is never refused for size. See research R-3 of the caption-translation spec.
export const TRANSLATE_CHUNK_MAX_BYTES = 5_000;

const MAX_IN_FLIGHT = 4;

/**
 * A language pair the service refuses, or a text it can't take: retrying
 * would fail the same way, so the handler records it and doesn't retry.
 */
export class UnsupportedLanguageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedLanguageError';
  }
}

let _client: TranslateClient | undefined;
const getTranslateClient = (): TranslateClient => {
  if (!_client) {
    _client = new TranslateClient({});
  }
  return _client;
};

const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');

// Cues never split: each chunk holds whole texts joined by a newline.
const chunkIndices = (texts: readonly string[], indices: number[]) => {
  const chunks: number[][] = [];
  let current: number[] = [];
  let bytes = 0;
  for (const index of indices) {
    const size = byteLength(texts[index]);
    const added = current.length === 0 ? size : size + 1;
    if (current.length > 0 && bytes + added > TRANSLATE_CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    bytes += current.length === 0 ? size : size + 1;
    current.push(index);
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

const runLimited = async <T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  return results;
};

/**
 * Translates cue texts with Amazon Translate: the non-empty texts are sent in
 * chunks of at most TRANSLATE_CHUNK_MAX_BYTES UTF-8 bytes (four requests at a
 * time) and each answer is split back into lines. A chunk answered with the
 * wrong number of lines is sent again one text per request. Empty texts are
 * not sent. `characters` is what the service charges for. In local dev the
 * stand-in answers and no SDK client is built.
 */
export const translateTexts = async (input: {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
}): Promise<{
  texts: string[];
  characters: number;
  requests: number;
  fallbacks: number;
}> => {
  const { sourceLanguage, targetLanguage } = input;
  const SourceLanguageCode = TRANSLATE_LANGUAGE_CODES[sourceLanguage];
  const TargetLanguageCode = TRANSLATE_LANGUAGE_CODES[targetLanguage];
  if (!SourceLanguageCode || !TargetLanguageCode) {
    throw new UnsupportedLanguageError(
      `No Amazon Translate code for ${SourceLanguageCode ? targetLanguage : sourceLanguage}`,
    );
  }
  // One text per line: a line break in a text would shift every cue after it.
  const texts = input.texts.map((text) => text.replace(/\s*\n\s*/g, ' '));
  const nonEmpty = texts.flatMap((text, i) => (text === '' ? [] : [i]));
  const characters = nonEmpty.reduce((sum, i) => sum + [...texts[i]].length, 0);

  if (isLocalDev()) {
    return {
      texts: translateLocally({ texts, sourceLanguage, targetLanguage }),
      characters,
      requests: nonEmpty.length === 0 ? 0 : 1,
      fallbacks: 0,
    };
  }

  const tooLong = nonEmpty.find(
    (i) => byteLength(texts[i]) > TRANSLATE_CHUNK_MAX_BYTES,
  );
  if (tooLong !== undefined) {
    throw new UnsupportedLanguageError(
      `A caption text is over ${TRANSLATE_CHUNK_MAX_BYTES} bytes`,
    );
  }

  const out = texts.map(() => '');
  let sentCharacters = 0;
  let requests = 0;
  let fallbacks = 0;

  const send = async (text: string): Promise<string> => {
    requests += 1;
    sentCharacters += [...text].length;
    try {
      const { TranslatedText } = await getTranslateClient().send(
        new TranslateTextCommand({
          Text: text,
          SourceLanguageCode,
          TargetLanguageCode,
        }),
      );
      return TranslatedText ?? '';
    } catch (error) {
      if (
        (error as { name?: string })?.name ===
        'UnsupportedLanguagePairException'
      ) {
        throw new UnsupportedLanguageError(
          `Amazon Translate does not translate ${sourceLanguage} to ${targetLanguage}`,
        );
      }
      throw error;
    }
  };

  await runLimited(
    chunkIndices(texts, nonEmpty).map((chunk) => async () => {
      const answer = (await send(chunk.map((i) => texts[i]).join('\n'))).split(
        '\n',
      );
      if (answer.length === chunk.length) {
        chunk.forEach((i, n) => {
          out[i] = answer[n];
        });
        return;
      }
      fallbacks += 1;
      for (const i of chunk) {
        out[i] = (await send(texts[i])).replace(/\s*\n\s*/g, ' ');
      }
    }),
    MAX_IN_FLIGHT,
  );

  return { texts: out, characters: sentCharacters, requests, fallbacks };
};
