/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  BrandDocumentSchema,
  BrandFieldsSchema,
  DEFAULT_BRAND,
  resolveBrand,
} from './brand.js';

const BASE = 'https://media.example.com/';
const NONCE = '0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12';

const fields = {
  name: 'Acme Academy',
  showNameBesideLogo: false,
  colour: '#1d4ed8',
  logoKey: `brand/logo/${NONCE}.svg`,
  iconKey: `brand/icon/${NONCE}.png`,
  shareImageKey: `brand/share-image/${NONCE}.jpg`,
};

describe('resolveBrand', () => {
  it('is the default brand when nothing is saved', () => {
    expect(resolveBrand(undefined, BASE)).toEqual({
      name: 'Discava',
      showNameBesideLogo: true,
      logoUrl: DEFAULT_BRAND.logoUrl,
      iconUrl: null,
      shareImageUrl: null,
      palette: null,
    });
  });

  it('resolves each field', () => {
    const brand = resolveBrand(fields, BASE);
    expect(brand.name).toBe('Acme Academy');
    expect(brand.showNameBesideLogo).toBe(false);
    expect(brand.logoUrl).toBe(`${BASE}brand/logo/${NONCE}.svg`);
    expect(brand.iconUrl).toBe(`${BASE}brand/icon/${NONCE}.png`);
    expect(brand.shareImageUrl).toBe(`${BASE}brand/share-image/${NONCE}.jpg`);
    expect(brand.palette?.variables['--primary']).toBe('#1d4ed8');
  });

  it('uses the defaults for null fields', () => {
    const brand = resolveBrand(
      {
        ...fields,
        name: null,
        colour: null,
        logoKey: null,
        iconKey: null,
        shareImageKey: null,
      },
      BASE,
    );
    expect(brand.name).toBe('Discava');
    expect(brand.logoUrl).toBe(DEFAULT_BRAND.logoUrl);
    expect(brand.palette).toBeNull();
  });

  it('uses default images when there is no media base to resolve them in', () => {
    const brand = resolveBrand(fields, undefined);
    expect(brand.logoUrl).toBe(DEFAULT_BRAND.logoUrl);
    expect(brand.iconUrl).toBeNull();
  });
});

describe('BrandDocumentSchema', () => {
  it('parses a document with an extra field, ignoring it', () => {
    const parsed = BrandDocumentSchema.parse({
      ...fields,
      revision: 3,
      futureField: 'x',
    });
    expect(parsed.revision).toBe(3);
    expect(parsed).not.toHaveProperty('futureField');
  });

  it('fails on a bad colour', () => {
    expect(
      BrandDocumentSchema.safeParse({
        ...fields,
        revision: 1,
        colour: '#777777',
      }).success,
    ).toBe(false);
  });

  it('fails on a key of the wrong kind', () => {
    expect(
      BrandDocumentSchema.safeParse({
        ...fields,
        revision: 1,
        iconKey: `brand/logo/${NONCE}.png`,
      }).success,
    ).toBe(false);
  });

  it('fails without a revision of at least 1', () => {
    expect(BrandDocumentSchema.safeParse(fields).success).toBe(false);
    expect(
      BrandDocumentSchema.safeParse({ ...fields, revision: 0 }).success,
    ).toBe(false);
  });
});

describe('BrandFieldsSchema', () => {
  it('trims the name and normalises the colour', () => {
    const parsed = BrandFieldsSchema.parse({
      ...fields,
      name: '  Acme  ',
      colour: '#1D4ED8',
    });
    expect(parsed.name).toBe('Acme');
    expect(parsed.colour).toBe('#1d4ed8');
  });

  it('refuses an empty or 51-character name', () => {
    expect(
      BrandFieldsSchema.safeParse({ ...fields, name: '   ' }).success,
    ).toBe(false);
    expect(
      BrandFieldsSchema.safeParse({ ...fields, name: 'a'.repeat(51) }).success,
    ).toBe(false);
    expect(
      BrandFieldsSchema.safeParse({ ...fields, name: 'a'.repeat(50) }).success,
    ).toBe(true);
  });
});
