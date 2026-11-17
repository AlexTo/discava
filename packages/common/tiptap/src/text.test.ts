/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { plainTextExcerpt } from './text.js';

const doc = (...content: unknown[]) => JSON.stringify({ type: 'doc', content });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: { type: string }[]) => ({
  type: 'text',
  text: value,
  ...(marks && { marks }),
});

describe('plainTextExcerpt', () => {
  it('joins paragraphs with single spaces', () => {
    const value = doc(paragraph(text('First.')), paragraph(text('Second.')));

    expect(plainTextExcerpt(value, 200)).toBe('First. Second.');
  });

  it('reads the items of a bulleted list', () => {
    const item = (value: string) => ({
      type: 'listItem',
      content: [paragraph(text(value))],
    });
    const value = doc(paragraph(text('Bring:')), {
      type: 'bulletList',
      content: [item('a pen'), item('paper')],
    });

    expect(plainTextExcerpt(value, 200)).toBe('Bring: a pen paper');
  });

  it('shows inline and block formulas as their LaTeX source', () => {
    const value = doc(
      paragraph(
        text('Solve '),
        { type: 'inlineMath', attrs: { latex: 'Ax = b' } },
        text(' for x.'),
      ),
      { type: 'blockMath', attrs: { latex: 'x^2' } },
    );

    expect(plainTextExcerpt(value, 200)).toBe('Solve Ax = b for x. x^2');
  });

  it('drops formatting', () => {
    const value = doc(
      paragraph(text('Bold', [{ type: 'bold' }]), text(' text')),
    );

    expect(plainTextExcerpt(value, 200)).toBe('Bold text');
  });

  it('collapses whitespace', () => {
    const value = doc(paragraph(text('  a \n  b   c  ')));

    expect(plainTextExcerpt(value, 200)).toBe('a b c');
  });

  it('cuts a long body at a word boundary and marks the cut', () => {
    const value = doc(paragraph(text('word '.repeat(1000))));

    const excerpt = plainTextExcerpt(value, 200);

    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt.slice(0, -1)).toMatch(/^(word )*word$/);
  });

  it('cuts a single long word at the limit', () => {
    const value = doc(paragraph(text('x'.repeat(500))));

    const excerpt = plainTextExcerpt(value, 50);

    expect(excerpt).toBe(`${'x'.repeat(49)}…`);
  });

  it('adds no ellipsis when nothing is cut', () => {
    expect(plainTextExcerpt(doc(paragraph(text('Short'))), 5)).toBe('Short');
  });

  it('keeps markup as text', () => {
    const value = doc(paragraph(text('<script>alert(1)</script> hi')));

    expect(plainTextExcerpt(value, 200)).toBe('<script>alert(1)</script> hi');
  });

  it.each(['not json', JSON.stringify({ type: 'image' }), ''])(
    'returns an empty string for an unparsable document (%j)',
    (value) => {
      expect(plainTextExcerpt(value, 200)).toBe('');
    },
  );
});
