/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The document title for a page: its parts (empty ones dropped), then the
 * platform's name, joined with " · ".
 */
export function pageTitle(
  name: string,
  ...parts: (string | null | undefined | false)[]
): string {
  return [...parts.filter((part): part is string => !!part), name].join(' · ');
}
