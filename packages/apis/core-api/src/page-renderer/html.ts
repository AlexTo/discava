/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { brandPalette } from '@discava/common-branding/colour';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text or an attribute value, safe between tags or inside quotes. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] as string);

/**
 * JSON for the inside of a `<script>` tag: `<`, `>` and `&` are written as
 * unicode escapes, so no value can close the tag or open a comment. Also
 * escapes U+2028 and U+2029, which older parsers treat as line breaks.
 */
export const jsonForScript = (value: unknown): string =>
  (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const DESCRIPTION_MAX = 155;

/** A meta description: whitespace collapsed, cut at 155 characters on a word boundary. */
export const metaDescription = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= DESCRIPTION_MAX) {
    return flat;
  }
  const cut = flat.slice(0, DESCRIPTION_MAX + 1);
  const lastSpace = cut.lastIndexOf(' ');
  // A single long word has no boundary to cut at.
  return (
    lastSpace > 0 ? cut.slice(0, lastSpace) : flat.slice(0, DESCRIPTION_MAX)
  ).trimEnd();
};

const ROOT_MARKER = '<div id="root"></div>';
const HEAD_END = '</head>';
const TITLE = /<title>[\s\S]*?<\/title>\s*/;
const THEME_COLOUR = /<meta\b[^>]*\bname=["']theme-color["'][^>]*>\s*/gi;
const ICON_LINK = /<link\b[^>]*\brel=["']icon["'][^>]*>\s*/gi;

/** The brand a page carries: its icon, and the document the portal starts from. */
export interface PageBrand {
  /** The brand's icon URL, or null for the template's own. */
  iconUrl: string | null;
  /** The brand colour, or none for the template's own look. Anything but a readable hex is ignored. */
  colour?: string | null;
  /** The published brand document, embedded in the page data; none before a first save. */
  document?: unknown;
}

// The page data with the brand added under `brand`, which BrandProvider reads
// at start-up. Page data is JSON text already safe for a script tag.
const withBrand = (pageData: string | undefined, document: unknown): string => {
  if (document === undefined) {
    return pageData ?? '';
  }
  const data = pageData
    ? (JSON.parse(pageData) as Record<string, unknown>)
    : {};
  return jsonForScript({ ...data, brand: document });
};

// The brand colour's variables as a `:root` rule, and the theme colour for the
// browser's chrome. Both are built from `brandPalette`, whose output is a
// validated `#rrggbb` or `var(--foreground)`, so the colour can't leave the
// style element. Empty when there is no usable colour.
const colourHead = (colour: string | null | undefined): string => {
  const palette = colour ? brandPalette(colour) : undefined;
  if (!palette?.ok) {
    return '';
  }
  const rules = Object.entries(palette.variables)
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  return `\n<style>:root{${rules}}</style>\n<meta name="theme-color" content="${palette.variables['--primary']}" />`;
};

/**
 * Puts a page into the portal's `index.html`: `head` before `</head>` (the
 * template's own title is dropped, since `head` carries the page's), `root`
 * inside the empty root element, and `pageData` (JSON text) in a script right
 * after it. A brand with an icon replaces the template's `<link rel="icon">`
 * and adds the touch icon; a brand colour adds its `:root` style and theme
 * colour (replacing the template's); a brand document is embedded in the page data.
 * Throws when either marker is missing, so a changed template fails loudly
 * instead of serving a broken page.
 */
export const injectIntoTemplate = (
  template: string,
  parts: {
    head: string;
    root: string;
    pageData?: string;
    brand?: PageBrand;
  },
): string => {
  if (!template.includes(HEAD_END)) {
    throw new Error('The page template has no </head>');
  }
  if (!template.includes(ROOT_MARKER)) {
    throw new Error('The page template has no <div id="root"></div>');
  }
  const pageDataText = withBrand(parts.pageData, parts.brand?.document);
  const pageData = pageDataText
    ? `<script type="application/json" id="discava-page-data">${pageDataText}</script>`
    : '';
  const iconUrl = parts.brand?.iconUrl;
  const icons = iconUrl
    ? `\n<link rel="icon" type="image/png" href="${escapeHtml(iconUrl)}" />\n<link rel="apple-touch-icon" href="${escapeHtml(iconUrl)}" />`
    : '';
  const colour = colourHead(parts.brand?.colour);
  // Replacers are functions: `$` in the content must not be read as a pattern.
  const base = iconUrl ? template.replace(ICON_LINK, () => '') : template;
  return (colour ? base.replace(THEME_COLOUR, () => '') : base)
    .replace(TITLE, () => '')
    .replace(HEAD_END, () => `${parts.head}${icons}${colour}${HEAD_END}`)
    .replace(
      ROOT_MARKER,
      () => `<div id="root">${parts.root}</div>${pageData}`,
    );
};
