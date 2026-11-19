/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The ISO instant in a well-formed UUID v7, or undefined for anything else. */
export const uuidV7Time = (id: string): string | undefined => {
  if (!UUID_V7.test(id)) {
    return undefined;
  }
  const time = new Date(
    Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16),
  );
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
};

export type IdTimeProblem = 'not-uuid-v7' | 'outside-window';

export type IdTimeCheck =
  | { time: string; reason?: undefined }
  | { time?: undefined; reason: IdTimeProblem };

/**
 * Whether `id` is a UUID v7 minted at most `ahead` milliseconds after and at
 * most `behind` milliseconds before `now`, with its ISO time when it is.
 */
export const idTimeWithin = (
  id: string,
  now: Date,
  ahead: number,
  behind: number,
): IdTimeCheck => {
  const time = uuidV7Time(id);
  if (time === undefined) {
    return { reason: 'not-uuid-v7' };
  }
  const offset = new Date(time).getTime() - now.getTime();
  if (offset > ahead || offset < -behind) {
    return { reason: 'outside-window' };
  }
  return { time };
};
