/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** The issue a pull request says it closes, e.g. "Closes #42". */
export const closedIssue = (prBody: string | null): number | undefined => {
  const match = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(
    prBody ?? '',
  );
  return match ? Number(match[1]) : undefined;
};

/** The spec folders (`specs/<folder>/...`) among a pull request's files. */
export const specFolders = (files: string[]): string[] => [
  ...new Set(
    files.flatMap((file) => {
      const match = /^specs\/([^/]+)\//.exec(file);
      return match ? [match[1]] : [];
    }),
  ),
];
