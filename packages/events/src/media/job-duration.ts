/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The transcoded duration, in seconds, from a job's output group details (the
 * longest output's `durationInMs`); undefined when none is reported.
 */
export const durationSecondsOf = (
  groups:
    | readonly { durationsInMs: readonly (number | undefined)[] }[]
    | undefined,
): number | undefined => {
  const all = (groups ?? [])
    .flatMap((group) => group.durationsInMs)
    .filter((ms): ms is number => typeof ms === 'number');
  return all.length > 0 ? Math.max(...all) / 1000 : undefined;
};
