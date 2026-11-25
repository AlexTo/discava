/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthPlugin,
  createLoggerPlugin,
  IAuthContext,
} from './trpc-middleware.js';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = loggerMocks.info;
    error = loggerMocks.error;
  },
}));

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

describe('createLoggerPlugin', () => {
  const lt = initTRPC.create();
  const loggerRouter = lt.router({
    refuse: lt.procedure.concat(createLoggerPlugin()).query(() => {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }),
    forbid: lt.procedure.concat(createLoggerPlugin()).query(() => {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }),
    crash: lt.procedure.concat(createLoggerPlugin()).query(() => {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        cause: new Error('boom'),
      });
    }),
  });
  const loggerCaller = lt.createCallerFactory(loggerRouter)({});

  it.each(['refuse', 'forbid'] as const)(
    'does not log expected %s refusals at error level',
    async (procedure) => {
      loggerMocks.info.mockClear();
      loggerMocks.error.mockClear();
      await expect(loggerCaller[procedure]()).rejects.toBeInstanceOf(TRPCError);
      expect(loggerMocks.error).not.toHaveBeenCalled();
      expect(loggerMocks.info).toHaveBeenCalledWith(
        'Request refused',
        expect.objectContaining({ path: procedure }),
      );
    },
  );

  it('still logs internal errors at error level', async () => {
    loggerMocks.error.mockClear();
    await expect(loggerCaller.crash()).rejects.toBeInstanceOf(TRPCError);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Unexpected error occurred',
      expect.objectContaining({
        code: 'INTERNAL_SERVER_ERROR',
        path: 'crash',
      }),
    );
  });
});
