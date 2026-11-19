/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** What reading the template returned: unchanged since `etag`, or a new body. */
export type TemplateRead =
  | { notModified: true }
  | { notModified?: false; body: string; etag?: string };

/** Reads `index.html`, conditionally on the `ETag` of the body already held. */
export type TemplateSource = (
  etag: string | undefined,
) => Promise<TemplateRead>;

/**
 * Keeps the last template and its `ETag`, and asks the source on every call
 * whether it changed. There is no fixed-time cache: a portal deploy replaces
 * `index.html` and invalidates the distribution, and a warm renderer must not
 * keep the old file (which names deleted bundles). A failed read throws, and
 * the cached body is not used in its place, since it may be the stale one.
 */
export const createTemplateLoader = (source: TemplateSource) => {
  let cached: { body: string; etag: string | undefined } | undefined;
  return async (): Promise<string> => {
    const read = await source(cached?.etag);
    if (read.notModified) {
      if (!cached) {
        throw new Error('The template source reported 304 with nothing cached');
      }
      return cached.body;
    }
    cached = { body: read.body, etag: read.etag };
    return read.body;
  };
};
