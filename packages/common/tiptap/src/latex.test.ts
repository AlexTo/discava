/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { renderLatex } from './latex.js';

describe('renderLatex', () => {
  it('renders a formula inline', () => {
    const result = renderLatex('\\frac{a}{b}');
    expect(result).toEqual({ html: expect.stringContaining('katex') });
    expect('html' in result && result.html).not.toContain('katex-display');
  });

  it('renders a formula as a block', () => {
    expect(renderLatex('x^2', { display: true })).toEqual({
      html: expect.stringContaining('katex-display'),
    });
  });

  it('explains LaTeX it cannot render, instead of throwing', () => {
    expect(renderLatex('\\frac{a}{b')).toEqual({
      error: expect.stringMatching(/expected '}'/i),
    });
    expect(renderLatex('\\notacommand')).toEqual({
      error: expect.stringContaining('\\notacommand'),
    });
  });

  it("doesn't run commands that could link out of the page", () => {
    // KaTeX's `trust` is off by default, so \href is shown, not followed.
    const result = renderLatex('\\href{https://example.com}{x}');
    expect('html' in result && result.html).not.toContain('<a ');
  });
});
