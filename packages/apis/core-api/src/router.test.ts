/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { t } from './init.js';
import { appRouter, PUBLIC_OPERATIONS } from './router.js';

// Anonymous calls reach no data: any table access fails the call, which is
// fine here, since only whether it was refused as UNAUTHORIZED matters.
vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => {
    throw new Error('no table in this test');
  }),
}));

const anonymousCaller = t.createCallerFactory(appRouter)({
  event: { requestContext: {} } as unknown as APIGatewayProxyEvent,
  context: {} as any,
  info: {} as any,
});

// Calls the operation with no Cognito claims and reports whether it was
// refused for that, as opposed to failing any other way (bad input, the
// missing table) or succeeding.
const refusesAnonymousCallers = async (path: string) => {
  const call = path
    .split('.')
    .reduce<any>((node, segment) => node[segment], anonymousCaller);
  try {
    await call({});
    return false;
  } catch (error) {
    return (error as { code?: string }).code === 'UNAUTHORIZED';
  }
};

describe('PUBLIC_OPERATIONS', () => {
  // Every operation, keyed by the dotted path API Gateway exposes it at.
  const all = Object.keys(appRouter._def.procedures);

  it('lists only operations that exist', () => {
    expect(all).toEqual(expect.arrayContaining([...PUBLIC_OPERATIONS]));
  });

  it.each(all)('matches how %s treats an anonymous caller', async (path) => {
    // A public procedure listed here is served without a Cognito token, and
    // a protected one must not be: API Gateway's authorizer is the first
    // check, so a mismatch either 401s signed-out visitors or lets them
    // reach a procedure that then refuses them anyway.
    expect(await refusesAnonymousCallers(path)).toBe(
      !(PUBLIC_OPERATIONS as readonly string[]).includes(path),
    );
  });
});
