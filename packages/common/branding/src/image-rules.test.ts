/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  brandImageExtension,
  brandImageKey,
  checkBrandImage,
  isBrandImageKey,
} from './image-rules.js';

const MB = 1024 * 1024;
const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';

const logo = (over: Partial<Parameters<typeof checkBrandImage>[0]> = {}) =>
  checkBrandImage({
    kind: 'logo',
    contentType: 'image/png',
    bytes: 1000,
    width: 400,
    height: 100,
    ...over,
  });

describe('checkBrandImage: logo', () => {
  it('accepts every allowed type', () => {
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
    ]) {
      expect(logo({ contentType })).toEqual({ ok: true });
    }
  });

  it('refuses a GIF', () => {
    const result = logo({ contentType: 'image/gif' });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toMatch(/PNG, JPEG, WebP or SVG/);
  });

  it('accepts exactly 1 MB and refuses one byte more', () => {
    expect(logo({ bytes: MB })).toEqual({ ok: true });
    expect(logo({ bytes: MB + 1 })).toMatchObject({ ok: false });
  });

  it('accepts 1:1 and 4:1 and refuses either side of them', () => {
    expect(logo({ width: 100, height: 100 })).toEqual({ ok: true });
    expect(logo({ width: 400, height: 100 })).toEqual({ ok: true });
    expect(logo({ width: 99, height: 100 })).toMatchObject({ ok: false });
    expect(logo({ width: 401, height: 100 })).toMatchObject({ ok: false });
  });

  it('names the broken rule in the message', () => {
    const result = logo({ width: 420, height: 100 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.message).toContain('420 × 100');
      expect(result.message).toContain('width ÷ height from 1 to 4');
    }
  });

  it('refuses an image with no size', () => {
    expect(logo({ width: 0, height: 0 })).toMatchObject({ ok: false });
  });
});

describe('checkBrandImage: icon', () => {
  const icon = (width: number, height: number, contentType = 'image/png') =>
    checkBrandImage({
      kind: 'icon',
      contentType,
      bytes: 1000,
      width,
      height,
    });

  it('accepts a square 192 × 192 and refuses 191 × 191', () => {
    expect(icon(192, 192)).toEqual({ ok: true });
    expect(icon(191, 191)).toMatchObject({ ok: false });
  });

  it('refuses a non-square icon', () => {
    expect(icon(512, 256)).toMatchObject({ ok: false });
  });

  it('refuses an SVG or JPEG icon', () => {
    expect(icon(512, 512, 'image/svg+xml')).toMatchObject({ ok: false });
    expect(icon(512, 512, 'image/jpeg')).toMatchObject({ ok: false });
  });
});

describe('checkBrandImage: share image', () => {
  const share = (
    width: number,
    height: number,
    bytes = 1000,
    contentType = 'image/jpeg',
  ) =>
    checkBrandImage({ kind: 'share-image', contentType, bytes, width, height });

  it('accepts 1200 × 630 (1.9:1) and refuses 1199 × 630', () => {
    expect(share(1200, 630)).toEqual({ ok: true });
    expect(share(1199, 630)).toMatchObject({ ok: false });
  });

  it('accepts exactly 2 MB and refuses more', () => {
    expect(share(1200, 630, 2 * MB)).toEqual({ ok: true });
    expect(share(1200, 630, 2 * MB + 1)).toMatchObject({ ok: false });
  });

  it('refuses a ratio of 1.79 and accepts 1.8 and 2', () => {
    expect(share(1790, 1000)).toMatchObject({ ok: false });
    expect(share(1800, 1000)).toEqual({ ok: true });
    expect(share(2000, 1000)).toEqual({ ok: true });
    expect(share(2010, 1000)).toMatchObject({ ok: false });
  });

  it('refuses an SVG', () => {
    expect(share(1200, 630, 1000, 'image/svg+xml')).toMatchObject({
      ok: false,
    });
  });
});

describe('brand image keys', () => {
  it('round-trips a key', () => {
    const key = brandImageKey(
      'logo',
      NONCE,
      brandImageExtension('image/svg+xml'),
    );
    expect(key).toBe(`brand/logo/${NONCE}.svg`);
    expect(isBrandImageKey('logo', key)).toBe(true);
  });

  it('rejects keys of another kind, prefix or extension', () => {
    expect(isBrandImageKey('icon', `brand/logo/${NONCE}.png`)).toBe(false);
    expect(isBrandImageKey('logo', `courses/${NONCE}.png`)).toBe(false);
    expect(isBrandImageKey('icon', `brand/icon/${NONCE}.svg`)).toBe(false);
    expect(
      isBrandImageKey('share-image', `brand/share-image/${NONCE}.svg`),
    ).toBe(false);
    expect(isBrandImageKey('logo', `brand/logo/${NONCE}.png/x`)).toBe(false);
    expect(isBrandImageKey('logo', 'brand/logo/../x.png')).toBe(false);
  });
});
