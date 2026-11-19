/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Up to two letters from the first and last word of the name.
export const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0], words[words.length - 1]].map((word) => word[0])
      : [words[0]?.[0] ?? '?'];
  return letters.join('').toUpperCase();
};
