/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isValidTiptapDocument, parseTiptapDocument } from './document.js';

const doc = (...content: unknown[]) => JSON.stringify({ type: 'doc', content });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string) => ({ type: 'text', text: value });
const inlineMath = (latex: string) => ({
  type: 'inlineMath',
  attrs: { latex },
});
const blockMath = (latex: string) => ({ type: 'blockMath', attrs: { latex } });

describe('isValidTiptapDocument', () => {
  it.each([
    ['plain text', doc(paragraph(text('Hello')))],
    [
      'formatting the editor offers',
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('one'))] }],
        },
        { type: 'codeBlock', attrs: { language: null }, content: [text('x')] },
      ),
    ],
    [
      'inline maths within a sentence',
      doc(paragraph(text('Solve '), inlineMath('Ax = b'), text(' for x.'))),
    ],
    [
      'block maths on its own line',
      doc(
        paragraph(text('The system:')),
        blockMath('\\begin{bmatrix} 2 & -1 \\\\ -1 & 2 \\end{bmatrix}'),
      ),
    ],
    ['an empty paragraph, as an empty editor produces', doc(paragraph())],
  ])('accepts %s', (_, value) => {
    expect(isValidTiptapDocument(value)).toBe(true);
  });

  it.each([
    ['a node the editor has no extension for', doc({ type: 'image' })],
    [
      'block maths inside a paragraph',
      doc(paragraph(text('x '), blockMath('x'))),
    ],
    ['inline maths outside a paragraph', doc(inlineMath('x'))],
    ['a document with no content', doc()],
    ['something other than a document', JSON.stringify(paragraph())],
    ['text that is not JSON', 'not json'],
  ])('rejects %s', (_, value) => {
    expect(isValidTiptapDocument(value)).toBe(false);
  });
});

describe('parseTiptapDocument', () => {
  it('parses a stored document', () => {
    expect(parseTiptapDocument(doc(paragraph()))).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [] }],
    });
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['text that is not JSON', '{'],
  ])('gives undefined for %s', (_, value) => {
    expect(parseTiptapDocument(value)).toBeUndefined();
  });
});
