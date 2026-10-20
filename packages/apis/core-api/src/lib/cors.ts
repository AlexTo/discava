/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/**
 * The exact origin to allow for a credentialed CORS response: the request's
 * own origin if it's localhost (a local frontend against a deployed API) or
 * one of ALLOWED_ORIGINS (set via `restrictCorsTo` in the API CDK
 * construct). Undefined when no allowlist is configured, so the header is
 * omitted -- '*' is never valid alongside credentials.
 */
export const getAllowedOrigin = (
  event: APIGatewayProxyEvent | undefined,
): string | undefined => {
  const origin = event?.headers?.origin ?? event?.headers?.Origin;
  // Browsers send the literal "null" for opaque origins (e.g. sandboxed
  // iframes); that and malformed values get no CORS permission.
  if (origin && !URL.canParse(origin)) {
    return undefined;
  }
  const allowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? [];
  if (origin && LOCAL_HOSTNAMES.has(new URL(origin).hostname)) {
    return origin;
  }
  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }
  return allowedOrigins[0];
};
