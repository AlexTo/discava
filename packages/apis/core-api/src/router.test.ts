/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
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

const anonymousCaller = callerFor(appRouter);

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

  it('does not list the unsubscribe route, which is served beside the router', () => {
    expect(all.filter((path) => /unsubscribe/i.test(path))).toEqual([]);
    expect(
      PUBLIC_OPERATIONS.filter((path) => /unsubscribe/i.test(path)),
    ).toEqual([]);
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

describe('payment', () => {
  it('mounts checkout and available, neither public', async () => {
    expect(Object.keys(appRouter._def.procedures)).toEqual(
      expect.arrayContaining([
        'payment.checkout',
        'payment.available',
        'payment.requestRefund',
        'payment.myOrder',
      ]),
    );
    expect(
      PUBLIC_OPERATIONS.filter((path) => path.startsWith('payment.')),
    ).toEqual([]);
    expect(await refusesAnonymousCallers('payment.checkout')).toBe(true);
    expect(await refusesAnonymousCallers('payment.requestRefund')).toBe(true);
    expect(await refusesAnonymousCallers('payment.myOrder')).toBe(true);
  });
});

describe('instructorProfile', () => {
  it('serves publicView to anonymous callers', () => {
    expect(Object.keys(appRouter._def.procedures)).toContain(
      'instructorProfile.publicView',
    );
    expect(PUBLIC_OPERATIONS).toContain('instructorProfile.publicView');
  });
});

describe('discussion', () => {
  const procedures = [
    'listQuestions',
    'thread',
    'ask',
    'reply',
    'vote',
    'accept',
    'report',
    'removeOwn',
  ].map((name) => `discussion.${name}`);

  it('mounts every procedure of the contract', () => {
    expect(Object.keys(appRouter._def.procedures)).toEqual(
      expect.arrayContaining(procedures),
    );
  });

  it.each(procedures)('refuses an anonymous caller on %s', async (path) => {
    expect(await refusesAnonymousCallers(path)).toBe(true);
  });

  it('lists none as public', () => {
    expect(
      PUBLIC_OPERATIONS.filter((path) => path.startsWith('discussion.')),
    ).toEqual([]);
  });
});
