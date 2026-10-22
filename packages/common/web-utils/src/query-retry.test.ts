/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { httpStatusOf, retryQuery } from './query-retry';

// As a tRPC client error carries the API's answer.
const trpcError = (httpStatus: number, code: string) =>
  Object.assign(new Error(code), { data: { code, httpStatus } });

describe('retryQuery', () => {
  it('gives up at once on answers that would come out the same', () => {
    for (const [status, code] of [
      [400, 'BAD_REQUEST'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
      [412, 'PRECONDITION_FAILED'],
    ] as const) {
      expect(retryQuery(0, trpcError(status, code))).toBe(false);
    }
  });

  it('retries server errors, timeouts and rate limits up to three times', () => {
    for (const error of [
      trpcError(500, 'INTERNAL_SERVER_ERROR'),
      trpcError(408, 'TIMEOUT'),
      trpcError(429, 'TOO_MANY_REQUESTS'),
    ]) {
      expect(retryQuery(0, error)).toBe(true);
      expect(retryQuery(2, error)).toBe(true);
      expect(retryQuery(3, error)).toBe(false);
    }
  });

  it('retries a failure with no HTTP answer, such as the network dropping', () => {
    expect(retryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryQuery(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('httpStatusOf', () => {
  it('reads the status a tRPC error carries, and nothing from anything else', () => {
    expect(httpStatusOf(trpcError(404, 'NOT_FOUND'))).toBe(404);
    expect(httpStatusOf(new Error('no data'))).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
    expect(httpStatusOf({ data: { httpStatus: '404' } })).toBeUndefined();
  });
});
