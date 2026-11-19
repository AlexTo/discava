/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type TitlePart = { text: string; match: boolean };

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

// Letters and digits, so punctuation and spaces separate words.
const WORD = /([\p{L}\p{N}]+)/u;

/**
 * `title` in parts, marking the leading characters of each word that starts
 * with one of the words in `typed` (ignoring case and accents), which is what
 * the suggestions query matched (research R-5). The parts' text always joins
 * back to `title`.
 */
export const highlightTitle = (title: string, typed: string): TitlePart[] => {
  const prefixes = typed.split(/\s+/).filter(Boolean);
  const parts: TitlePart[] = [];
  const add = (text: string, match: boolean) => {
    if (!text) {
      return;
    }
    const last = parts[parts.length - 1];
    if (last?.match === match) {
      last.text += text;
    } else {
      parts.push({ text, match });
    }
  };

  for (const token of title.split(WORD)) {
    const length = prefixes
      .filter(
        (prefix) =>
          token.length >= prefix.length &&
          collator.compare(token.slice(0, prefix.length), prefix) === 0,
      )
      .reduce((longest, prefix) => Math.max(longest, prefix.length), 0);
    add(token.slice(0, length), true);
    add(token.slice(length), false);
  }
  return parts;
};
