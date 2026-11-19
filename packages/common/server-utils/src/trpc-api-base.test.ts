/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createApiBase } from './trpc-api-base.js';

const buildEvent = (claims?: Record<string, unknown>) =>
  ({
    requestContext: { authorizer: claims ? { claims } : undefined },
  }) as unknown as APIGatewayProxyEvent;

const callWhoAmI = (
  requiredGroup: string | undefined,
  claims?: Record<string, unknown>,
) => {
  const { t, protectedProcedure } = createApiBase({
    serviceName: 'TestApi',
    requiredGroup,
  });
  const router = t.router({
    whoAmI: protectedProcedure.query((opts) => opts.ctx.user),
  });
  return t
    .createCallerFactory(router)({
      event: buildEvent(claims),
      context: {} as any,
      info: {} as any,
    })
    .whoAmI();
};

describe('createApiBase protectedProcedure', () => {
  it.each([undefined, 'instructor', 'admin'])(
    'throws UNAUTHORIZED without claims (group %s)',
    async (group) => {
      await expect(callWhoAmI(group, undefined)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    },
  );

  it.each(['instructor', 'admin'])(
    'throws FORBIDDEN outside the %s group',
    async (group) => {
      await expect(
        callWhoAmI(group, { sub: 'u1', 'cognito:groups': ['student'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(['instructor', 'admin'])(
    'lets a member of the %s group through',
    async (group) => {
      await expect(
        callWhoAmI(group, { sub: 'u1', 'cognito:groups': ['student', group] }),
      ).resolves.toMatchObject({ sub: 'u1' });
    },
  );

  it('lets any signed-in user through when no group is required', async () => {
    await expect(callWhoAmI(undefined, { sub: 'u1' })).resolves.toMatchObject({
      sub: 'u1',
    });
  });

  it('names the Powertools service and metrics namespace', () => {
    createApiBase({ serviceName: 'NamedApi' });
    expect(process.env.POWERTOOLS_SERVICE_NAME).toBe('NamedApi');
    expect(process.env.POWERTOOLS_METRICS_NAMESPACE).toBe('NamedApi');
  });
});
