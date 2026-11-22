/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import Config from './app-config';

/**
 * The document title for a page: its parts (empty ones dropped), then the
 * application name, joined with " · ".
 */
export function pageTitle(
  ...parts: (string | null | undefined | false)[]
): string {
  return [
    ...parts.filter((part): part is string => !!part),
    Config.applicationName,
  ].join(' · ');
}
