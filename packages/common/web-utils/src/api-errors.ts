/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// What to tell people when an API answers with only an error code. Most
// errors carry a message written for people (e.g. "Restore the lesson before
// adding content to it"); these are for the ones that don't (#235).
const MESSAGES: Record<string, string> = {
  BAD_REQUEST:
    "Something in what you entered isn't valid. Check it and try again.",
  UNAUTHORIZED: 'Your session has ended. Sign in again to carry on.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "This doesn't exist, or is no longer available.",
  CONFLICT: 'This changed while you were working on it. Reload and try again.',
  PRECONDITION_FAILED: "This can't be done right now. Reload and try again.",
  TOO_MANY_REQUESTS: 'Too many requests. Wait a moment and try again.',
};

const DEFAULT_MESSAGE = 'Something went wrong. Try again in a moment.';

// The message to show for a failed API call: the API's own message when it
// wrote one, otherwise a sentence for its error code. A message that is just
// the code, or a list of validation issues (JSON), isn't one written for
// people.
export const apiErrorMessage = (
  error: unknown,
  fallback: string = DEFAULT_MESSAGE,
): string => {
  const message = error instanceof Error ? error.message.trim() : '';
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  const written =
    message !== '' &&
    message !== code &&
    !message.startsWith('[') &&
    !message.startsWith('{');
  if (written) {
    return message;
  }
  return (typeof code === 'string' && MESSAGES[code]) || fallback;
};
