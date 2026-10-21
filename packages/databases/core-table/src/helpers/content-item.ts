/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A video waiting for its transcode carries this pair, which puts it in the
// contentItem entity's byTranscodePending index for the transcode reconciler
// (#125). Set both when a video becomes pending; remove both when it's ready
// or failed. Setting or removing only one would leave the index half-updated.

/** The attributes to set when a video starts waiting for its transcode. */
export const transcodePendingFrom = (since: Date) => ({
  transcodePending: 'pending' as const,
  transcodePendingSince: since.toISOString(),
});

/** The attributes to remove once it's ready or failed. */
export const TRANSCODE_PENDING_ATTRIBUTES = [
  'transcodePending',
  'transcodePendingSince',
] as const;
