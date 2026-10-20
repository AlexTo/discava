/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, describe, expect, it } from 'vitest';
import { getAllowedOrigin } from './cors.js';

const eventFrom = (origin?: string) =>
  ({ headers: origin ? { origin } : {} }) as unknown as APIGatewayProxyEvent;

describe('getAllowedOrigin', () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

  it('returns a matching allowlisted origin exactly', () => {
    process.env.ALLOWED_ORIGINS =
      'https://portal.example.com,https://d123.cloudfront.net';

    expect(getAllowedOrigin(eventFrom('https://d123.cloudfront.net'))).toBe(
      'https://d123.cloudfront.net',
    );
  });

  it('falls back to the first allowlisted origin for an unlisted one', () => {
    process.env.ALLOWED_ORIGINS = 'https://portal.example.com';

    expect(getAllowedOrigin(eventFrom('https://evil.example.net'))).toBe(
      'https://portal.example.com',
    );
  });

  // Credentialed responses can't use '*', so localhost gets its own origin.
  it.each(['http://localhost:4200', 'http://127.0.0.1:4300'])(
    'returns a localhost origin (%s) exactly',
    (origin) => {
      process.env.ALLOWED_ORIGINS = 'https://portal.example.com';

      expect(getAllowedOrigin(eventFrom(origin))).toBe(origin);
    },
  );

  it.each(['null', 'not a url', '://missing-scheme'])(
    'grants nothing for an opaque or malformed origin (%s) instead of throwing',
    (origin) => {
      process.env.ALLOWED_ORIGINS = 'https://portal.example.com';

      expect(getAllowedOrigin(eventFrom(origin))).toBeUndefined();
    },
  );

  it('never returns a wildcard when no allowlist is configured', () => {
    expect(
      getAllowedOrigin(eventFrom('https://portal.example.com')),
    ).toBeUndefined();
    expect(getAllowedOrigin(eventFrom())).toBeUndefined();
  });
});
