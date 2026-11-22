/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { robotsTxt } from './robots.js';

describe('robotsTxt', () => {
  it('lists the sitemap and the private paths when indexing is on', () => {
    expect(robotsTxt('learn.example.com', true)).toBe(
      'User-agent: *\nDisallow: /learn/*/\nDisallow: /my-learning\nDisallow: /signin\nDisallow: /search\nAllow: /\nSitemap: https://learn.example.com/sitemap.xml\n',
    );
  });

  it('disallows the free preview address', () => {
    const lines = robotsTxt('learn.example.com', true).split('\n');
    expect(lines).toContain('Disallow: /learn/*/');
    expect(lines).not.toContain('Allow: /learn/');
  });

  it('disallows everything when indexing is off', () => {
    expect(robotsTxt('learn.example.com', false)).toBe(
      'User-agent: *\nDisallow: /\n',
    );
  });
});
