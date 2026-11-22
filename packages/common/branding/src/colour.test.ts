/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  BRAND_VARIABLES,
  brandPalette,
  contrastRatio,
  parseHex,
  relativeLuminance,
} from './colour.js';

describe('parseHex', () => {
  it('normalises #rgb and #rrggbb in any case', () => {
    expect(parseHex('#FFF')).toBe('#ffffff');
    expect(parseHex('#1D4ED8')).toBe('#1d4ed8');
    expect(parseHex('#abc')).toBe('#aabbcc');
  });

  it.each(['', 'red', '1d4ed8', '#12', '#12345', '#1234567', '#gggggg'])(
    'rejects %j',
    (value) => {
      expect(parseHex(value)).toBeNull();
    },
  );
});

describe('contrast', () => {
  it('gives 21:1 for black on white', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
  });
});

describe('brandPalette', () => {
  it('refuses #777777, which reads on neither text colour', () => {
    const palette = brandPalette('#777777');
    expect(palette.ok).toBe(false);
    if (!palette.ok) {
      expect(palette.reason).toMatch(/hard to read/);
    }
  });

  it('gives a pale colour dark text and no brand links', () => {
    const palette = brandPalette('#facc15');
    expect(palette).toMatchObject({
      ok: true,
      textColour: 'dark',
      linkUsesBrand: false,
    });
    if (palette.ok) {
      expect(palette.variables['--brand-link']).toBe('var(--foreground)');
    }
  });

  it('gives a deep colour light text and brand links', () => {
    const palette = brandPalette('#1d4ed8');
    expect(palette).toMatchObject({
      ok: true,
      textColour: 'light',
      linkUsesBrand: true,
    });
    if (palette.ok) {
      expect(palette.variables['--primary']).toBe('#1d4ed8');
      expect(palette.variables['--primary-foreground']).toBe('#fafafa');
      expect(palette.variables['--brand-link']).toBe('#1d4ed8');
      expect(palette.contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects an invalid hex', () => {
    expect(brandPalette('blue').ok).toBe(false);
  });

  it('never sets --destructive or --accent', () => {
    for (const hex of ['#1d4ed8', '#facc15', '#ff0000']) {
      const palette = brandPalette(hex);
      expect(palette.ok).toBe(true);
      if (palette.ok) {
        const names = Object.keys(palette.variables).join(' ');
        expect(names).not.toMatch(/destructive|accent/);
      }
    }
  });

  it('sets exactly the variables BRAND_VARIABLES lists', () => {
    const palette = brandPalette('#1d4ed8');
    expect(palette.ok && Object.keys(palette.variables).sort()).toEqual(
      [...BRAND_VARIABLES].sort(),
    );
  });
});
