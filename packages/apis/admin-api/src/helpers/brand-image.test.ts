/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { head, getBytes } = vi.hoisted(() => ({
  head: vi.fn(),
  getBytes: vi.fn(),
}));

vi.mock('@discava/common-server-utils/public-media', () => ({
  headPublicMediaObject: head,
  getPublicMediaObjectBytes: getBytes,
}));

import { inspectBrandImage } from './brand-image.js';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(path.join(import.meta.dirname, '__fixtures__/brand', name)),
  );

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

// Serves a fixture as the stored object, declared as `contentType`.
const stored = (name: string, contentType?: string) => {
  const bytes = fixture(name);
  head.mockResolvedValue({
    contentType: contentType ?? TYPES[name.split('.').pop() ?? ''],
    contentLength: bytes.length,
  });
  getBytes.mockResolvedValue(bytes);
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('inspectBrandImage: valid images', () => {
  it.each([
    'logo.png',
    'logo.jpg',
    'logo.webp',
    'logo.svg',
    'logo-inkscape.svg',
    'logo-illustrator.svg',
  ])('accepts the %s logo', async (name) => {
    stored(name);
    expect(await inspectBrandImage('logo', 'brand/logo/x')).toEqual({
      ok: true,
    });
  });

  it('accepts a 512 × 512 PNG icon and a 1200 × 630 share image', async () => {
    stored('icon-512.png');
    expect(await inspectBrandImage('icon', 'brand/icon/x.png')).toEqual({
      ok: true,
    });
    stored('share.png');
    expect(
      await inspectBrandImage('share-image', 'brand/share-image/x.png'),
    ).toEqual({ ok: true });
  });
});

describe('inspectBrandImage: refused images', () => {
  it('refuses a missing object', async () => {
    head.mockResolvedValue(undefined);
    const result = await inspectBrandImage('logo', 'brand/logo/x.png');
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/was not uploaded/);
    expect(getBytes).not.toHaveBeenCalled();
  });

  it('refuses a PNG declared as JPEG', async () => {
    stored('logo.png', 'image/jpeg');
    const result = await inspectBrandImage('logo', 'brand/logo/x.jpg');
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/not really a JPG/);
  });

  it('refuses a file that is not an image', async () => {
    head.mockResolvedValue({ contentType: 'image/png', contentLength: 5 });
    getBytes.mockResolvedValue(new TextEncoder().encode('hello'));
    expect(await inspectBrandImage('logo', 'brand/logo/x.png')).toMatchObject({
      ok: false,
    });
  });

  it('refuses a 4.2:1 logo', async () => {
    stored('logo-wide.png');
    const result = await inspectBrandImage('logo', 'brand/logo/x.png');
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/420 × 100/);
  });

  it('refuses a 191 × 191 icon and a non-square icon', async () => {
    stored('icon-191.png');
    expect(await inspectBrandImage('icon', 'brand/icon/x.png')).toMatchObject({
      ok: false,
    });
    stored('icon-nonsquare.png');
    expect(await inspectBrandImage('icon', 'brand/icon/x.png')).toMatchObject({
      ok: false,
    });
  });

  it('refuses an object over the size limit without reading it', async () => {
    head.mockResolvedValue({
      contentType: 'image/png',
      contentLength: 1024 * 1024 + 1,
    });
    expect(await inspectBrandImage('logo', 'brand/logo/x.png')).toMatchObject({
      ok: false,
    });
    expect(getBytes).not.toHaveBeenCalled();
  });

  it('refuses a body longer than the read limit', async () => {
    head.mockResolvedValue({ contentType: 'image/png', contentLength: 10 });
    getBytes.mockRejectedValue(new Error('too long'));
    expect(await inspectBrandImage('logo', 'brand/logo/x.png')).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ['bad-script.svg', /<script>/],
    ['bad-onload.svg', /event handler/],
    ['bad-href.svg', /link to https:\/\/evil/],
    ['bad-foreignobject.svg', /<foreignobject>/],
    ['bad-import.svg', /stylesheet/],
    ['bad-animate-href.svg', /animation/],
    ['bad-style-url.svg', /outside the file/],
  ])('refuses the SVG %s', async (name, message) => {
    stored(name);
    const result = await inspectBrandImage('logo', 'brand/logo/x.svg');
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(message);
  });

  describe('what a browser would substitute: entities and character references', () => {
    const doc = (body: string, dtd = '') =>
      new TextEncoder().encode(
        `${dtd ? `<!DOCTYPE svg [${dtd}]>\n` : ''}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${body}</svg>`,
      );
    const serve = (bytes: Uint8Array) => {
      head.mockResolvedValue({
        contentType: 'image/svg+xml',
        contentLength: bytes.length,
      });
      getBytes.mockResolvedValue(bytes);
    };
    const inspect = async (bytes: Uint8Array) => {
      serve(bytes);
      return inspectBrandImage('logo', 'brand/logo/x.svg');
    };

    it.each([
      ['markup in the value', '<!ENTITY x "<script>alert(1)</script>">'],
      ['markup in single quotes', "<!ENTITY x '<script>alert(1)</script>'>"],
      [
        'a character reference that makes markup',
        '<!ENTITY x "&#60;script&#62;alert(1)&#60;/script&#62;">',
      ],
      ['a reference to another entity', '<!ENTITY a "b"><!ENTITY x "&a;">'],
      ['an external entity', '<!ENTITY x SYSTEM "https://evil.example/x.xml">'],
      [
        'a public external entity',
        '<!ENTITY x PUBLIC "-//X//Y" "https://evil.example/x">',
      ],
      ['a parameter entity', '<!ENTITY % x "<!ENTITY y \'z\'>">'],
      ['an unterminated declaration', '<!ENTITY x "a"'],
      [
        'a default attribute that runs code',
        '<!ATTLIST rect onload CDATA "alert(1)">',
      ],
      ['an element declaration', '<!ELEMENT rect ANY>'],
    ])('refuses a DTD with %s', async (_name, dtd) => {
      const result = await inspect(doc('&x;', dtd));
      expect(result).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).toMatch(/DTD/);
    });

    it('refuses a DTD with more entities than any logo needs', async () => {
      const dtd = Array.from(
        { length: 21 },
        (_, i) => `<!ENTITY e${i} "v">`,
      ).join('');
      expect(await inspect(doc('', dtd))).toMatchObject({ ok: false });
    });

    // The rules see the expanded values, so each is refused exactly as if the
    // value had been written out.
    it.each([
      [
        'an animation target written through an entity',
        '<a><animate attributeName="&h;" values="javascript:alert(1)"/><text y="20">x</text></a>',
        '<!ENTITY h "href">',
        /animation/,
      ],
      [
        'an outside URL written through an entity',
        '<rect width="1" height="1" style="fill:&u;"/>',
        '<!ENTITY u "url(https://evil.example/x.png)">',
        /outside the file/,
      ],
      [
        'a link written through an entity',
        '<image href="&l;" width="1" height="1"/>',
        '<!ENTITY l "https://evil.example/x.png">',
        /link to/,
      ],
      [
        'a stylesheet import written through an entity',
        '<style>&i;</style>',
        '<!ENTITY i "@import url(https://evil.example/x.css);">',
        /stylesheet/,
      ],
      [
        'an event handler name written through numeric references',
        '<rect width="1" height="1" o&#110;load="alert(1)"/>',
        '',
        null,
      ],
    ])('refuses %s', async (_name, body, dtd, message) => {
      const result = await inspect(doc(body, dtd));
      expect(result).toMatchObject({ ok: false });
      if (message) expect(JSON.stringify(result)).toMatch(message);
    });

    it.each([
      [
        'a decimal character reference in a link animation target',
        '<a><animate attributeName="&#104;ref" values="javascript:alert(1)"/><text y="20">x</text></a>',
        /animation/,
      ],
      [
        'a decimal character reference in a url()',
        '<rect width="1" height="1" style="fill:&#117;rl(https://evil.example/x.png)"/>',
        /outside the file/,
      ],
      [
        'a hex character reference in a link',
        '<image href="&#x68;ttps://evil.example/x.png" width="1" height="1"/>',
        /link to/,
      ],
      [
        'a character reference in a stylesheet',
        '<style>&#64;import url(https://evil.example/x.css);</style>',
        /stylesheet/,
      ],
    ])('refuses %s', async (_name, body, message) => {
      const result = await inspect(doc(body));
      expect(result).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).toMatch(message);
    });

    it('refuses a character reference that is not a character', async () => {
      expect(
        await inspect(doc('<rect width="1" height="1" data-x="&#1114112;"/>')),
      ).toMatchObject({ ok: false });
    });

    it('is not fooled by text that looks like a namespace declaration', async () => {
      const result = await inspect(
        doc(
          `<rect width="1" height="1" data-a=' xmlns="' style='fill:&u;' data-b='"'/>`,
          '<!ENTITY u "url(https://evil.example/x.png)">',
        ),
      );
      expect(result).toMatchObject({ ok: false });
      expect(JSON.stringify(result)).toMatch(/outside the file/);
    });

    it('accepts the predefined entities and numeric character references that are harmless', async () => {
      expect(
        await inspect(
          doc(
            '<text y="20" title="a &amp; b &lt; c &#65; &#x42;">x &amp; y</text>',
          ),
        ),
      ).toEqual({ ok: true });
    });

    it('accepts plain-text entities, as Illustrator writes for its namespaces', async () => {
      expect(
        await inspect(
          new TextEncoder().encode(
            '<!DOCTYPE svg [<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">]>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="&ns_extend;" viewBox="0 0 200 100"><rect width="1" height="1"/></svg>',
          ),
        ),
      ).toEqual({ ok: true });
    });

    it('accepts a harmless plain-text entity used for text', async () => {
      expect(
        await inspect(doc('<text y="20">&t;</text>', '<!ENTITY t "hello">')),
      ).toEqual({ ok: true });
    });
  });

  it('refuses text that is not an SVG', async () => {
    head.mockResolvedValue({ contentType: 'image/svg+xml', contentLength: 9 });
    getBytes.mockResolvedValue(new TextEncoder().encode('<html></html>'));
    expect(await inspectBrandImage('logo', 'brand/logo/x.svg')).toMatchObject({
      ok: false,
    });
  });

  it('refuses an SVG with no viewBox or size', async () => {
    head.mockResolvedValue({ contentType: 'image/svg+xml', contentLength: 9 });
    getBytes.mockResolvedValue(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    expect(await inspectBrandImage('logo', 'brand/logo/x.svg')).toMatchObject({
      ok: false,
    });
  });
});
