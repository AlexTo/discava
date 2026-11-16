/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A day: the most a saved position or a duration may be. Longer than any
// lesson video, and small enough to reject nonsense.
export const VIDEO_POSITION_MAX_SECONDS = 86_400;

// Within this many seconds of the end, or past this share of the video, a
// student has finished watching and the next visit starts over.
const FINISHED_WITHIN_SECONDS = 10;
const FINISHED_SHARE = 0.95;

/** Whether a value is a position we may store: whole seconds, 0 to the cap. */
export const isValidPosition = (value: unknown): boolean =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= VIDEO_POSITION_MAX_SECONDS;

/**
 * The position to store for what the player reported: the floored position,
 * or 0 once the student has all but finished (so they start over). A video of
 * 10 seconds or less counts as finished only at its end.
 */
export const videoPositionToStore = (
  positionSeconds: number,
  durationSeconds: number,
): number => {
  const position = Math.floor(positionSeconds);
  if (durationSeconds <= FINISHED_WITHIN_SECONDS) {
    return positionSeconds >= durationSeconds ? 0 : position;
  }
  if (
    durationSeconds - positionSeconds <= FINISHED_WITHIN_SECONDS ||
    positionSeconds / durationSeconds >= FINISHED_SHARE
  ) {
    return 0;
  }
  return position;
};

/** Where to resume: the saved position, only for the version it was saved on. */
export const resumeAt = (
  record: { versionId: string; positionSeconds: number } | undefined,
  playedVersionId: string,
): number =>
  record && record.versionId === playedVersionId ? record.positionSeconds : 0;
