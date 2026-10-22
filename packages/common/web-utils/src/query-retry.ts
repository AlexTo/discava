/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// TanStack Query's own default.
const MAX_RETRIES = 3;

// Client errors that can come out differently if asked again: a timeout, or
// being told to slow down.
const RETRYABLE_CLIENT_ERRORS = new Set([408, 429]);

// The HTTP status of a tRPC error, which the APIs put in its `data`.
export const httpStatusOf = (error: unknown): number | undefined => {
  const status = (error as { data?: { httpStatus?: unknown } } | null)?.data
    ?.httpStatus;
  return typeof status === 'number' ? status : undefined;
};

// The portals' `retry` for queries (#236). An answer that won't change if
// asked again (not found, forbidden, invalid input, and the like) is shown at
// once instead of after three more tries; a network failure or server error
// is retried as TanStack Query does by default.
export const retryQuery = (failureCount: number, error: unknown): boolean => {
  const status = httpStatusOf(error);
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_ERRORS.has(status)
  ) {
    return false;
  }
  return failureCount < MAX_RETRIES;
};
