/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildEvent,
  type CallerOptions,
  callerFor,
} from '@discava/common-server-utils/trpc-testing';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { describe, expect, it } from 'vitest';
import { protectedProcedure, t } from './init.js';

const router = t.router({
  whoAmI: protectedProcedure.query((opts) => opts.ctx.user),
});
const callWhoAmI = (options?: CallerOptions) =>
  callerFor(router, options).whoAmI();

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
        event: buildEvent(),
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
