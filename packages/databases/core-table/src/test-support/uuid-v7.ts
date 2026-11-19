/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** A UUID v7 whose time part is `at`; `last` makes ids from one instant differ. */
export const uuidV7At = (at: Date | string | number, last = 1) => {
  const ms = new Date(at).getTime().toString(16).padStart(12, '0');
  return `${ms.slice(0, 8)}-${ms.slice(8)}-7000-8000-${String(last).padStart(12, '0')}`;
};
