/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** `robots.txt`: the signed-in routes closed and the site map named, or everything closed when indexing is off. */
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
