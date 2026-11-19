/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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

/**
 * Puts a page into the portal's `index.html`: `head` before `</head>` (the
 * template's own title is dropped, since `head` carries the page's), `root`
 * inside the empty root element, and `pageData` (JSON text) in a script right
 * after it. Throws when either marker is missing, so a changed template fails
 * loudly instead of serving a broken page.
 */
export const injectIntoTemplate = (
  template: string,
  parts: { head: string; root: string; pageData?: string },
): string => {
  if (!template.includes(HEAD_END)) {
    throw new Error('The page template has no </head>');
  }
  if (!template.includes(ROOT_MARKER)) {
    throw new Error('The page template has no <div id="root"></div>');
  }
  const pageData = parts.pageData
    ? `<script type="application/json" id="discava-page-data">${parts.pageData}</script>`
    : '';
  // Replacers are functions: `$` in the content must not be read as a pattern.
  return template
    .replace(TITLE, () => '')
    .replace(HEAD_END, () => `${parts.head}${HEAD_END}`)
    .replace(
      ROOT_MARKER,
      () => `<div id="root">${parts.root}</div>${pageData}`,
    );
};
