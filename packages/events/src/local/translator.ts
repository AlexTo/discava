/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { UnsupportedLanguageError } from '../media/translate-client.js';

/**
 * Stands in for Amazon Translate in local dev: each non-empty text becomes
 * `[<targetLanguage>] <text>` and an empty one stays empty. A text containing
 * `[[fail-translation]]` or `[[fail-translation:<targetLanguage>]]` fails as a
 * language the service refuses, so a deliberate failure shows at once and is
 * not retried.
 */
export const translateLocally = ({
  texts,
  targetLanguage,
}: {
  texts: string[];
  sourceLanguage: string;
  targetLanguage: string;
}): string[] => {
  const markers = [
    '[[fail-translation]]',
    `[[fail-translation:${targetLanguage}]]`,
  ];
  return texts.map((text) => {
    if (markers.some((marker) => text.includes(marker))) {
      throw new UnsupportedLanguageError(
        `Local translation to ${targetLanguage} was made to fail`,
      );
    }
    return text === '' ? '' : `[${targetLanguage}] ${text}`;
  });
};
