/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export function parseStageName(
  firstArg: string | undefined,
): string | undefined {
  if (!firstArg || firstArg.startsWith('-')) return undefined;
  return firstArg.includes('/') ? firstArg.split('/')[0] : firstArg;
}
