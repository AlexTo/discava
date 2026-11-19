/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** `robots.txt`, as the page renderer contract gives it. */
export const robotsTxt = (host: string, allowIndexing: boolean): string =>
  allowIndexing
    ? [
        'User-agent: *',
        'Disallow: /learn/*/',
        'Disallow: /my-learning',
        'Disallow: /signin',
        'Disallow: /search',
        'Allow: /',
        `Sitemap: https://${host}/sitemap.xml`,
        '',
      ].join('\n')
    : 'User-agent: *\nDisallow: /\n';
