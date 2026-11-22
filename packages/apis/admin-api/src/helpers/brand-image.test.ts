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
