/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { syncLocalUser } from '@discava/common-server-utils/local-dev';
import {
  type CreateHTTPContextOptions,
  createHTTPServer,
} from '@trpc/server/adapters/standalone';
import cors from 'cors';
import { appRouter } from './router.js';

const PORT = 2022;

createHTTPServer({
  router: appRouter,
  middleware: cors({ origin: true, credentials: true }),
  async createContext({ req }: CreateHTTPContextOptions) {
    const claims = decodeClaims(req);
    // What Cognito's pre token generation trigger does at sign-in when
    // deployed: keep the user's core table record in step (#230).
    await syncLocalUser(claims);
    return {
      event: {
        requestContext: { authorizer: { claims } },
      } as any,
      context: {} as any,
      info: {} as any,
      responseCookies: [] as string[],
    };
  },
  // Deployed, video playback's signed CloudFront cookies go out this way.
  // Locally there are none: lesson media is served unsigned from S3Mock
  // (#137), so this passes on whatever a procedure sets.
  responseMeta: ({ ctx }) =>
    ctx?.responseCookies?.length
      ? { headers: { 'set-cookie': ctx.responseCookies } }
      : {},
}).listen(PORT);

console.log(`Local TRPC server listening on port ${PORT}`);

// There's no API Gateway locally to verify the caller's token and flatten it into
// event.requestContext.authorizer.claims, so decode it ourselves from the real
// Authorization header the frontend sends (see CoreApiClientProvider). Locally
// the token comes from the local OIDC server (#226), with the same claims as
// Cognito's; we don't verify its signature, which API Gateway does once deployed.
const decodeClaims = (
  req: CreateHTTPContextOptions['req'],
): Record<string, string> | undefined => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  const payload = token?.split('.')[1];
  if (!payload) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return undefined;
  }
};
