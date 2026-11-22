/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './api-errors';

// As a tRPC client error carries the API's answer.
const trpcError = (code: string, message: string = code) =>
  Object.assign(new Error(message), { data: { code } });

describe('apiErrorMessage', () => {
  it('keeps a message the API wrote for people', () => {
    expect(
      apiErrorMessage(
        trpcError(
          'PRECONDITION_FAILED',
          'Restore the lesson before adding content to it',
        ),
      ),
    ).toBe('Restore the lesson before adding content to it');
  });

  it('puts an error that is only its code into words', () => {
    expect(apiErrorMessage(trpcError('FORBIDDEN'))).toBe(
      "You don't have permission to do that.",
    );
    expect(apiErrorMessage(trpcError('NOT_FOUND'))).toBe(
      "This doesn't exist, or is no longer available.",
    );
  });

  it('puts validation issues (JSON) into words', () => {
    expect(
      apiErrorMessage(
        trpcError('BAD_REQUEST', '[{"code":"too_small","path":["title"]}]'),
      ),
    ).toBe(
      "Something in what you entered isn't valid. Check it and try again.",
    );
  });

  it('falls back for codes without a sentence, and for anything else', () => {
    expect(apiErrorMessage(trpcError('CLIENT_CLOSED_REQUEST'))).toBe(
      'Something went wrong. Try again in a moment.',
    );
    expect(apiErrorMessage(undefined, "Couldn't save the video")).toBe(
      "Couldn't save the video",
    );
  });

  it('keeps the message of an error that isn’t from the API', () => {
    expect(apiErrorMessage(new Error('The upload was interrupted'))).toBe(
      'The upload was interrupted',
    );
  });

  it.each([
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
  ])(
    'tells people a request with no answer could not reach Discava: %s',
    (message) => {
      expect(apiErrorMessage(new Error(message))).toBe(
        "Couldn't reach Discava. Check your connection and try again.",
      );
    },
  );

  it('treats an error caused by a TypeError as no answer', () => {
    expect(
      apiErrorMessage(
        new Error('Request failed', { cause: new TypeError('x') }),
      ),
    ).toBe("Couldn't reach Discava. Check your connection and try again.");
  });

  it('words a server fault whatever its message', () => {
    expect(
      apiErrorMessage(
        trpcError('INTERNAL_SERVER_ERROR', 'Output validation failed'),
      ),
    ).toBe('Something went wrong on our side. Try again in a moment.');
  });
});
