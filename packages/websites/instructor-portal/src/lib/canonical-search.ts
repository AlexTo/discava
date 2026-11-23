/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { redirect } from '@tanstack/react-router';

/**
 * A route's `beforeLoad` calls this with the address as it was typed and the
 * address its validated values would write (a value at its default is
 * `undefined`). When they differ, an invalid or redundant value is in the
 * address, so it is replaced, not pushed, and Back doesn't return to it.
 */
export const correctSearch = (
  raw: Record<string, unknown>,
  canonical: Record<string, string | undefined>,
) => {
  if (Object.entries(canonical).every(([key, value]) => raw[key] === value)) {
    return;
  }
  throw redirect({
    to: '.',
    search: ((prev: Record<string, unknown>) => ({
      ...prev,
      ...canonical,
    })) as never,
    replace: true,
  });
};
