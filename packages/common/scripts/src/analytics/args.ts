/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The course ids a rebuild is asked for: every argument, each a plain id.
 * Throws a usage message otherwise, so a typo can't rebuild nothing quietly.
 */
export const parseCourseIds = (args: string[]): string[] => {
  // `nx run ... -- <courseId>` may pass the separator through.
  const ids = args.filter((arg) => arg !== '--');
  if (ids.length === 0) {
    throw new Error('Usage: rebuild-analytics <courseId> [<courseId> ...]');
  }
  const bad = ids.find((id) => !/^[A-Za-z0-9_-]+$/.test(id));
  if (bad !== undefined) {
    throw new Error(`"${bad}" is not a course id`);
  }
  return [...new Set(ids)];
};
