/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  injectIntoTemplate,
  jsonForScript,
  metaDescription,
} from './html.js';

const HOSTILE = '</script><script>alert(1)</script>';

describe('escapeHtml', () => {
  it('escapes tags, quotes and ampersands', () => {
    expect(escapeHtml(HOSTILE)).toBe(
      '&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('a & "b" \'c\'')).toBe(
      'a &amp; &quot;b&quot; &#39;c&#39;',
    );
  });
});

describe('jsonForScript', () => {
  it('writes <, > and & as unicode escapes and round-trips', () => {
    const value = { a: HOSTILE, b: 'x & "y"' };
    const json = jsonForScript(value);
    expect(json).not.toMatch(/[<>&]/);
    expect(json).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(json)).toEqual(value);
  });

  it('escapes line separators', () => {
    expect(jsonForScript('a\u2028b')).not.toContain('\u2028');
  });
});

describe('metaDescription', () => {
  it('leaves short text alone and collapses whitespace', () => {
    expect(metaDescription('  a\n\n b  ')).toBe('a b');
  });

  it('cuts at 155 characters on a word boundary', () => {
    const text = `${'word '.repeat(60)}`;
    const out = metaDescription(text);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith('word')).toBe(true);
  });

  it('cuts a single long word at 155', () => {
    expect(metaDescription('x'.repeat(300))).toHaveLength(155);
  });
});

describe('injectIntoTemplate', () => {
  const template =
    '<html><head><title>Discava</title></head><body><div id="root"></div></body></html>';

  it('inserts the head, root and page data, replacing the title', () => {
    const out = injectIntoTemplate(template, {
      head: '<title>T</title>',
      root: '<h1>Hi</h1>',
      pageData: '{"a":1}',
    });
    expect(out).toBe(
      '<html><head><title>T</title></head><body><div id="root"><h1>Hi</h1></div><script type="application/json" id="discava-page-data">{"a":1}</script></body></html>',
    );
  });

  describe('the brand', () => {
    const withIcon =
      '<html><head><title>Discava</title><link rel="icon" type="image/x-icon" href="/favicon.ico" /></head><body><div id="root"></div></body></html>';
    const document = { revision: 2, name: 'Acme', colour: null };

    it('replaces the template’s icon with the brand’s, and adds the touch icon', () => {
      const out = injectIntoTemplate(withIcon, {
        head: '<title>T</title>',
        root: '',
        brand: { iconUrl: 'https://media.test/brand/icon/x.png' },
      });
      expect(out).not.toContain('favicon.ico');
      expect(out).toContain(
        '<link rel="icon" type="image/png" href="https://media.test/brand/icon/x.png" />',
      );
      expect(out).toContain(
        '<link rel="apple-touch-icon" href="https://media.test/brand/icon/x.png" />',
      );
      expect(out.match(/rel="icon"/g)).toHaveLength(1);
    });

    it('keeps the template’s icon when the brand has none', () => {
      const out = injectIntoTemplate(withIcon, {
        head: '',
        root: '',
        brand: { iconUrl: null },
      });
      expect(out).toContain('href="/favicon.ico"');
      expect(out).not.toContain('apple-touch-icon');
    });

    it('escapes the icon URL', () => {
      const out = injectIntoTemplate(withIcon, {
        head: '',
        root: '',
        brand: { iconUrl: 'https://media.test/"><script>x</script>' },
      });
      expect(out).not.toContain('<script>x');
    });

    it('embeds the brand document in the page data, beside the page’s own', () => {
      const out = injectIntoTemplate(template, {
        head: '',
        root: '',
        pageData: '{"a":1}',
        brand: { iconUrl: null, document },
      });
      const json = /id="discava-page-data">([^<]*)</.exec(out)?.[1] ?? '';
      expect(JSON.parse(json)).toEqual({ a: 1, brand: document });
    });

    it('embeds the brand alone on a page with no data of its own', () => {
      const out = injectIntoTemplate(template, {
        head: '',
        root: '',
        brand: { iconUrl: null, document },
      });
      const json = /id="discava-page-data">([^<]*)</.exec(out)?.[1] ?? '';
      expect(JSON.parse(json)).toEqual({ brand: document });
    });

    it('cannot be broken out of the script by a brand name', () => {
      const out = injectIntoTemplate(template, {
        head: '',
        root: '',
        brand: { iconUrl: null, document: { name: HOSTILE } },
      });
      expect(out.match(/<\/script>/g)).toHaveLength(1);
    });

    it('writes no page data without a brand document or page data', () => {
      const out = injectIntoTemplate(template, {
        head: '',
        root: '',
        brand: { iconUrl: null },
      });
      expect(out).not.toContain('discava-page-data');
    });
  });

  it('does not read $ in the content as a replacement pattern', () => {
    const out = injectIntoTemplate(template, {
      head: '',
      root: "$& $' $1",
    });
    expect(out).toContain('<div id="root">$& $\' $1</div>');
  });

  it('throws when a marker is missing', () => {
    expect(() =>
      injectIntoTemplate('<head></head><body></body>', { head: '', root: '' }),
    ).toThrow(/root/);
    expect(() =>
      injectIntoTemplate('<div id="root"></div>', { head: '', root: '' }),
    ).toThrow(/head/);
  });

  it("finds both markers in the student portal's index.html", () => {
    const html = readFileSync(
      resolve(
        fileURLToPath(import.meta.url),
        '../../../../../websites/student-portal/index.html',
      ),
      'utf-8',
    );
    expect(() =>
      injectIntoTemplate(html, { head: '', root: 'x' }),
    ).not.toThrow();
  });
});
