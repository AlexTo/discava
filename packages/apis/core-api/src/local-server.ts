/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
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
  createContext({ req }: CreateHTTPContextOptions) {
    return {
      event: {
        requestContext: { authorizer: { claims: decodeClaims(req) } },
      } as any,
      context: {} as any,
      info: {} as any,
      responseCookies: [] as string[],
    };
  },
  // Browsers reject these cookies' Domain from a localhost response, so video
  // playback doesn't work against this server (see #137).
  responseMeta: ({ ctx }) =>
    ctx?.responseCookies?.length
      ? { headers: { 'set-cookie': ctx.responseCookies } }
      : {},
}).listen(PORT);

console.log(`Local TRPC server listening on port ${PORT}`);

// There's no API Gateway locally to verify the caller's Cognito token and flatten
// it into event.requestContext.authorizer.claims, so decode it ourselves from the
// real Authorization header the frontend sends (see CoreApiClientProvider). The
// token still comes from a genuine Cognito sign-in in the browser — we just don't
// re-verify the signature here, since API Gateway already does that once deployed.
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
