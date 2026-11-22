/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { describe, expect, it } from 'vitest';
import { buildHead, type PageContext } from './page.js';

const context = (allowIndexing: boolean): PageContext => ({
  host: 'learn.example.com',
  siteName: 'Discava',
  allowIndexing,
  mediaUrl: () => undefined,
  defaultImageUrl: 'https://learn.example.com/og-default.png',
  brand: resolveBrand(undefined, undefined),
});

const page = {
  title: 'A page',
  description: 'About it',
  path: '/learn/c1',
  type: 'website' as const,
  structuredData: { '@type': 'Course' },
};

const ROBOTS = '<meta name="robots" content="noindex" />';

describe('buildHead', () => {
  it('omits the robots tag on an indexable stage and writes it otherwise', () => {
    expect(buildHead(context(true), page)).not.toContain(ROBOTS);
    expect(buildHead(context(false), page)).toContain(ROBOTS);
  });

  it('writes the structured data script when given', () => {
    expect(buildHead(context(true), page)).toContain(
      '<script type="application/ld+json">',
    );
  });

  it('forces the robots tag with noindex whatever the stage allows', () => {
    expect(buildHead(context(true), { ...page, noindex: true })).toContain(
      ROBOTS,
    );
    expect(buildHead(context(false), { ...page, noindex: true })).toContain(
      ROBOTS,
    );
  });

  it('writes no ld+json script when structured data is omitted', () => {
    const { structuredData: _omitted, ...bare } = page;
    expect(buildHead(context(true), bare)).not.toContain('ld+json');
  });
});
