/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { protectedProcedure, t } from './init.js';

const buildEvent = (claims?: Record<string, string>): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  }) as unknown as APIGatewayProxyEvent;

const router = t.router({
  whoAmI: protectedProcedure.query((opts) => opts.ctx.user),
});
const caller = t.createCallerFactory(router);

const callWhoAmI = (claims?: Record<string, string>) =>
  caller({
    event: buildEvent(claims),
    context: {} as any,
    info: {} as any,
  }).whoAmI();

describe('protectedProcedure', () => {
  it('throws UNAUTHORIZED when the caller has no Cognito claims', async () => {
    await expect(callWhoAmI(undefined)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('resolves ctx.user when the caller has valid Cognito claims', async () => {
    const user = await callWhoAmI({ sub: 'user-1' });
    expect(user).toMatchObject({ sub: 'user-1' });
  });
});

describe('error responses', () => {
  it('never include the server’s stack trace', async () => {
    const response = await fetchRequestHandler({
      endpoint: '',
      req: new Request('http://api.test/whoAmI'),
      router,
      createContext: () => ({
        event: buildEvent(undefined),
        context: {} as any,
        info: {} as any,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.data.code).toBe('UNAUTHORIZED');
    expect(body.error.data).not.toHaveProperty('stack');
  });
});
