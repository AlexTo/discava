/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LOCAL_PORTAL_URLS,
  syncLocalUser,
} from '@discava/common-server-utils/local-dev';
import { resolveUnsubscribeSecret } from '@discava/common-server-utils/unsubscribe-token';
import {
  createCoreTableService,
  NOTIFICATION_TYPES,
  setNotificationPreference,
} from '@discava/core-table';
import {
  type CreateHTTPContextOptions,
  createHTTPServer,
} from '@trpc/server/adapters/standalone';
import cors from 'cors';
import { unsubscribeMiddleware } from './local-unsubscribe.js';
import { appRouter } from './router.js';

const PORT = 2022;

// The public unsubscribe route (not tRPC), as the deployed function serves it.
const unsubscribe = unsubscribeMiddleware(async () => {
  const [secret, service] = await Promise.all([
    resolveUnsubscribeSecret(),
    createCoreTableService(),
  ]);
  return {
    secret,
    setEmailEnabled: (userId, type, enabled) =>
      setNotificationPreference(service, userId, type, enabled),
    typeInfo: (type) =>
      Object.hasOwn(NOTIFICATION_TYPES, type)
        ? NOTIFICATION_TYPES[type]
        : undefined,
  };
}, LOCAL_PORTAL_URLS.student);
const trpcCors = cors({ origin: true, credentials: true });

createHTTPServer({
  router: appRouter,
  middleware: (req: any, res: any, next: () => void) =>
    unsubscribe(req, res, () => trpcCors(req, res, next)),
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
