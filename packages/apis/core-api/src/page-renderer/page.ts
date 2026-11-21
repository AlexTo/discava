/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { escapeHtml, jsonForScript, metaDescription } from './html.js';

/** What a page is rendered for. */
export interface PageContext {
  /** The viewer's host, already checked against the allowed list. */
  host: string;
  siteName: string;
  /** Whether search engines may index the page. */
  allowIndexing: boolean;
  /** A public media object's absolute URL, if it has a key and a base. */
  mediaUrl: (key: string | undefined) => string | undefined;
  /** The card image for pages with none of their own. */
  defaultImageUrl: string;
}

/** A page's pieces, for `injectIntoTemplate`. */
export interface RenderedPage {
  head: string;
  root: string;
  /** JSON text, already safe for a script tag. */
  pageData: string;
}

export const originOf = (host: string): string => `https://${host}`;

/** The shared head: title, description, canonical, social cards, robots, structured data. */
export const buildHead = (
  context: PageContext,
  page: {
    title: string;
    description: string;
    path: string;
    type: 'website' | 'profile';
    image?: string;
    /** Omitted: no structured data script. */
    structuredData?: unknown;
    /** Emit the robots tag whatever `context.allowIndexing` is. */
    noindex?: boolean;
  },
): string => {
  const title = escapeHtml(`${page.title} | ${context.siteName}`);
  const description = escapeHtml(metaDescription(page.description));
  const url = escapeHtml(`${originOf(context.host)}${page.path}`);
  const image = escapeHtml(page.image ?? context.defaultImageUrl);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    context.allowIndexing && !page.noindex
      ? ''
      : '<meta name="robots" content="noindex" />',
    `<meta property="og:type" content="${page.type}" />`,
    `<meta property="og:site_name" content="${escapeHtml(context.siteName)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    page.structuredData === undefined
      ? ''
      : `<script type="application/ld+json">${jsonForScript(page.structuredData)}</script>`,
  ]
    .filter(Boolean)
    .join('\n');
};

/** Paragraphs of plain text: a blank line separates them. */
export const paragraphsOf = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

export const paragraphsHtml = (text: string, className: string): string =>
  paragraphsOf(text)
    .map((paragraph) => `<p class="${className}">${escapeHtml(paragraph)}</p>`)
    .join('');

/** The title shown for a page that doesn't exist; shared so every 404 is the same bytes. */
export const notFoundHead = (context: PageContext): string =>
  [
    `<title>Not found | ${escapeHtml(context.siteName)}</title>`,
    '<meta name="robots" content="noindex" />',
  ].join('\n');
