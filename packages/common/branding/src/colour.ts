/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The theme's text colours, as hex, from
 * packages/common/shadcn/src/styles/globals.css: `--primary-foreground`
 * (oklch(0.985 0 0)), `--foreground` (oklch(0.145 0 0)) and `--background`
 * (oklch(1 0 0)). Keep them in step with that file.
 */
const LIGHT_TEXT = '#fafafa';
const DARK_TEXT = '#0a0a0a';
const BACKGROUND = '#ffffff';

/** The WCAG 2.x AA contrast for normal text. */
const MIN_CONTRAST = 4.5;

/** A lower-case `#rrggbb` from `#rgb` or `#rrggbb` in any case, else null. */
export const parseHex = (value: string): string | null => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const digits = match[1].toLowerCase();
  const full =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join('')
      : digits;
  return `#${full}`;
};

const channel = (hex: string, index: number): number => {
  const value =
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of a `#rrggbb` colour, from 0 to 1. */
export const relativeLuminance = (hex: string): number =>
  0.2126 * channel(hex, 0) +
  0.7152 * channel(hex, 1) +
  0.0722 * channel(hex, 2);

/** WCAG 2.x contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Every variable a brand palette can set, so a client can clear them all. */
export const BRAND_VARIABLES = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
  '--brand-link',
] as const;

/**
 * The light theme's value of every brand variable, from `:root` in
 * packages/common/shadcn/src/styles/globals.css (keep them in step). A preview
 * sets these when there is no usable brand colour, so it shows the default
 * rather than the colour the page itself has applied.
 */
export const DEFAULT_PALETTE_VARIABLES: Record<
  (typeof BRAND_VARIABLES)[number],
  string
> = {
  '--primary': 'oklch(0.205 0 0)',
  '--primary-foreground': 'oklch(0.985 0 0)',
  '--ring': 'oklch(0.708 0 0)',
  '--sidebar-primary': 'oklch(0.205 0 0)',
  '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
  '--sidebar-ring': 'oklch(0.708 0 0)',
  '--brand-link': 'var(--foreground)',
};

export type BrandPalette =
  | {
      ok: true;
      textColour: 'light' | 'dark';
      contrast: number;
      linkUsesBrand: boolean;
      variables: Record<string, string>;
    }
  | { ok: false; reason: string };

/**
 * The theme variables a brand colour overrides, or why it can't be used: text
 * on it must reach 4.5:1, in whichever of the theme's two text colours reads
 * better. Meaning colours (`--destructive`) and `--accent` are never set.
 */
export const brandPalette = (hex: string): BrandPalette => {
  const colour = parseHex(hex);
  if (!colour) {
    return {
      ok: false,
      reason: 'The colour must be a hex value like #1d4ed8.',
    };
  }
  const light = contrastRatio(colour, LIGHT_TEXT);
  const dark = contrastRatio(colour, DARK_TEXT);
  const textColour = light >= dark ? 'light' : 'dark';
  const contrast = Math.max(light, dark);
  if (contrast < MIN_CONTRAST) {
    return {
      ok: false,
      reason:
        'Text on this colour would be hard to read. Choose a darker or lighter shade.',
    };
  }
  const text = textColour === 'light' ? LIGHT_TEXT : DARK_TEXT;
  const linkUsesBrand = contrastRatio(colour, BACKGROUND) >= MIN_CONTRAST;
  return {
    ok: true,
    textColour,
    contrast,
    linkUsesBrand,
    variables: {
      '--primary': colour,
      '--primary-foreground': text,
      '--ring': colour,
      '--sidebar-primary': colour,
      '--sidebar-primary-foreground': text,
      '--sidebar-ring': colour,
      '--brand-link': linkUsesBrand ? colour : 'var(--foreground)',
    },
  };
};
