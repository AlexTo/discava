/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { createContentExtensions } from './extensions.js';

let schema: ReturnType<typeof getSchema> | undefined;

// A short plain-text summary of a stored document, for places that can't show
// rich text, such as a notification. Block texts are joined with single
// spaces, a formula is its LaTeX source, and whitespace is collapsed. Longer
// than `maxChars`, it is cut at the last word boundary that leaves room for
// the `…` appended to show the cut (a single longer word is cut where it
// stands). A document that doesn't parse or fit the content schema gives an
// empty string.
export const plainTextExcerpt = (
  document: string,
  maxChars: number,
): string => {
  const parts: string[] = [];
  try {
    schema ??= getSchema(createContentExtensions());
    const root = Node.fromJSON(schema, JSON.parse(document));
    root.check();
    root.descendants((node) => {
      if (node.isText) {
        parts.push(node.text ?? '');
      } else if (node.type.name === 'inlineMath') {
        parts.push(String(node.attrs.latex ?? ''));
      } else if (node.type.name === 'blockMath') {
        parts.push(` ${String(node.attrs.latex ?? '')} `);
      } else if (node.isBlock) {
        parts.push(' ');
      }
    });
  } catch {
    return '';
  }
  const text = parts.join('').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) {
    return text;
  }
  const room = text.slice(0, Math.max(0, maxChars - 1));
  // Cut at the last word boundary if the next character starts a new word or
  // the cut is mid-word; the whole prefix when it holds a single word.
  const boundary = /\s/.test(text.charAt(room.length))
    ? room.length
    : room.lastIndexOf(' ');
  const cut = boundary > 0 ? room.slice(0, boundary) : room;
  return `${cut.trimEnd()}…`;
};
