/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { isValidTiptapDocument } from '@discava/common-tiptap';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RichTextView } from './rich-text-view';

afterEach(cleanup);

const doc = (...content: object[]) => JSON.stringify({ type: 'doc', content });
const paragraph = (...content: object[]) => ({ type: 'paragraph', content });
const text = (value: string, ...marks: string[]) => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 && { marks: marks.map((type) => ({ type })) }),
});
const inlineMath = (latex: string) => ({
  type: 'inlineMath',
  attrs: { latex },
});
const blockMath = (latex: string) => ({ type: 'blockMath', attrs: { latex } });

const view = (value: string | undefined) =>
  render(<RichTextView value={value} />).container.querySelector(
    '[data-slot="rich-text-view"]',
  ) as HTMLElement;

describe('RichTextView', () => {
  it('shows what the editor can write', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Vectors')] },
      paragraph(
        text('A '),
        text('vector', 'bold'),
        text(' has a '),
        text('direction', 'italic'),
      ),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('magnitude'))] },
          { type: 'listItem', content: [paragraph(text('direction'))] },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [{ type: 'listItem', content: [paragraph(text('first'))] }],
      },
    );
    expect(isValidTiptapDocument(value)).toBe(true);

    const root = view(value);

    expect(root.querySelector('h2')?.textContent).toBe('Vectors');
    expect(root.querySelector('strong')?.textContent).toBe('vector');
    expect(root.querySelector('em')?.textContent).toBe('direction');
    expect(
      [...root.querySelectorAll('ul > li')].map((li) => li.textContent),
    ).toEqual(['magnitude', 'direction']);
    expect(root.querySelector('ol > li')?.textContent).toBe('first');
    // Read-only: rendered without an editor.
    expect(root.querySelector('[contenteditable]')).toBeNull();
  });

  it('renders inline and block formulas with KaTeX', () => {
    const root = view(
      doc(
        paragraph(text('Solve '), inlineMath('2x + 3 = 7'), text(' for x.')),
        blockMath('x = \\frac{7-3}{2}'),
      ),
    );

    const inline = root.querySelector('p [data-type="inline-math"]');
    expect(inline?.getAttribute('data-latex')).toBe('2x + 3 = 7');
    expect(inline?.querySelector('.katex')).not.toBeNull();
    expect(inline?.querySelector('.katex-display')).toBeNull();

    const block = root.querySelector('div[data-type="block-math"]');
    expect(block?.getAttribute('data-latex')).toBe('x = \\frac{7-3}{2}');
    expect(block?.querySelector('.katex-display .mfrac')).not.toBeNull();
  });

  it("shows LaTeX KaTeX can't parse as its source", () => {
    const root = view(doc(paragraph(inlineMath('\\frac{1')), blockMath('x^{')));

    const inline = root.querySelector('[data-type="inline-math"]');
    expect(inline?.classList).toContain('inline-math-error');
    expect(inline?.textContent).toBe('\\frac{1');
    const block = root.querySelector('[data-type="block-math"]');
    expect(block?.classList).toContain('block-math-error');
    expect(block?.textContent).toBe('x^{');
  });

  it('shows text as text, not markup', () => {
    const root = view(doc(paragraph(text('<img src=x onerror=alert(1)>'))));

    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it.each([
    ['no document', undefined],
    ['an empty string', ''],
    ['JSON that does not parse', '{"type":"doc"'],
    ['a node the schema lacks', doc({ type: 'table', content: [] })],
  ])('renders %s as empty', (_, value) => {
    expect(view(value).childNodes).toHaveLength(0);
  });
});
