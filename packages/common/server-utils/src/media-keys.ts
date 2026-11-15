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

/**
 * How long to keep a retired version of a video before deleting it: past the
 * last moment anyone could still hold cookies for it, with a margin.
 */
export const RETIRED_VERSION_DELAY_MINUTES =
  SIGNED_COOKIE_LIFETIME_SECONDS / 60 + 15;

/**
 * How long a file's download link works (#102): long enough to start the
 * download, short enough that a shared link soon stops working. A download
 * already under way isn't cut off when it expires.
 */
export const FILE_URL_LIFETIME_SECONDS = 5 * 60;

/**
 * How long after a student's file is replaced its old folder must be kept: a
 * download link issued just before the replacement works for
 * `FILE_URL_LIFETIME_SECONDS`, plus a minute's margin.
 */
export const REPLACED_FILE_GRACE_SECONDS = FILE_URL_LIFETIME_SECONDS + 60;

/**
 * How long a submit request's own folder is left before its guard cleanup
 * runs (the cleanup never deletes a folder holding a student's current file).
 * Far longer than the request's 25 s timeout, so it can't fire while the
 * request that scheduled it is still running.
 */
export const SUBMISSION_ATTEMPT_CLEANUP_DELAY_MINUTES = 60;
