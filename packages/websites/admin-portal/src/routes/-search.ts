/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// What the admin routes keep in the address (see the url-state contract). An
// empty or over-long value is dropped. The key is returned as undefined rather
// than left out, or the router would carry the raw value through.

export const reviewsSearch = (
  search: Record<string, unknown>,
): { course: string | undefined } => ({
  course:
    typeof search.course === 'string' &&
    search.course !== '' &&
    search.course.length <= 100
      ? search.course
      : undefined,
});

export const certificatesSearch = (
  search: Record<string, unknown>,
): { id: string | undefined } => {
  const id = typeof search.id === 'string' ? search.id.trim() : '';
  return { id: id !== '' && id.length <= 100 ? id : undefined };
};
