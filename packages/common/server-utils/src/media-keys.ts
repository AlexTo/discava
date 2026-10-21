/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The submission nonce a transcoded video's manifest lives under, from its
 * key: `courses/…/content-items/<contentItemId>/<nonce>/master.m3u8`. Each
 * transcode writes to its own nonce's folder, so that folder can be deleted
 * without touching any other version. Undefined for a manifest from before
 * nonces, stored directly under the content item's folder, whose deletion
 * would take every version with it.
 */
export const manifestNonce = (manifestKey: string): string | undefined =>
  manifestKey.match(/\/content-items\/[^/]+\/([^/]+)\/[^/]+$/)?.[1];

/**
 * How long a video's signed cookies last (see lesson-media). A viewer who got
 * them just before a version was retired can stream it until they expire, so
 * a retired version's output is kept at least this long.
 */
export const SIGNED_COOKIE_LIFETIME_SECONDS = 4 * 60 * 60;
