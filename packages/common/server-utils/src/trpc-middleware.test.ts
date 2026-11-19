/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initTRPC } from '@trpc/server';
import { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { createAuthPlugin, IAuthContext } from './trpc-middleware.js';

const buildEvent = (claims?: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  }) as unknown as APIGatewayProxyEvent;

const t = initTRPC
  .context<IAuthContext & CreateAWSLambdaContextOptions<APIGatewayProxyEvent>>()
  .create();
const router = t.router({
  whoAmI: t.procedure
    .concat(createAuthPlugin())
    .query((opts) => opts.ctx.user ?? null),
});
const caller = t.createCallerFactory(router);

const callWhoAmI = (claims?: Record<string, unknown>) =>
  caller({
    event: buildEvent(claims),
    context: {} as any,
    info: {} as any,
  }).whoAmI();

describe('createAuthPlugin', () => {
  it('leaves ctx.user undefined when there are no claims', async () => {
    expect(await callWhoAmI(undefined)).toBeNull();
  });

  it('leaves ctx.user undefined when claims have no sub', async () => {
    expect(await callWhoAmI({ email: 'a@b.com' })).toBeNull();
  });

  it('extracts sub, email, username and comma-separated groups', async () => {
    expect(
      await callWhoAmI({
        sub: 'user-1',
        email: 'a@b.com',
        'cognito:username': 'auser',
        'cognito:groups': 'student,instructor',
      }),
    ).toEqual({
      sub: 'user-1',
      email: 'a@b.com',
      username: 'auser',
      groups: ['student', 'instructor'],
    });
  });

  it('falls back to the plain username claim for access tokens', async () => {
    expect(
      await callWhoAmI({
        sub: 'user-1',
        username: 'auser',
      }),
    ).toEqual({
      sub: 'user-1',
      email: undefined,
      username: 'auser',
      groups: [],
    });
  });

  it('accepts a real string array for groups, as produced by decoding a raw JWT locally', async () => {
    expect(
      await callWhoAmI({
        sub: 'user-1',
        'cognito:groups': ['student', 'instructor'],
      }),
    ).toEqual({
      sub: 'user-1',
      email: undefined,
      username: undefined,
      groups: ['student', 'instructor'],
    });
  });

  it('parses bracketed groups format', async () => {
    expect(
      await callWhoAmI({
        sub: 'user-1',
        'cognito:groups': '[student, instructor]',
      }),
    ).toEqual({
      sub: 'user-1',
      email: undefined,
      username: undefined,
      groups: ['student', 'instructor'],
    });
  });

  it('defaults groups to an empty array when absent', async () => {
    expect(await callWhoAmI({ sub: 'user-1' })).toEqual({
      sub: 'user-1',
      email: undefined,
      username: undefined,
      groups: [],
    });
  });
});
