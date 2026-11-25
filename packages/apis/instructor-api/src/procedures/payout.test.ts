/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { account, dashboardLink, startOnboarding } from './payout.js';

// Powertools writes through the global console in dev mode, which a test can spy on.
vi.hoisted(() => {
  process.env.POWERTOOLS_DEV = 'true';
});

const { getConnection, saveAccountStatus, payoutGet, payoutStripe, stripe } =
  vi.hoisted(() => ({
    getConnection: vi.fn(),
    saveAccountStatus: vi.fn(),
    payoutGet: vi.fn(),
    payoutStripe: vi.fn(),
    stripe: {
      createExpressAccount: vi.fn(),
      retrieveAccount: vi.fn(),
      createAccountLink: vi.fn(),
      createLoginLink: vi.fn(),
    },
  }));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  getConnection,
  saveAccountStatus,
  createCoreTableService: vi.fn(async () => ({
    entities: { payoutAccount: { get: payoutGet } },
  })),
}));
vi.mock(
  '@discava/common-server-utils/stripe/payouts',
  async (importActual) => ({
    ...(await importActual<
      typeof import('@discava/common-server-utils/stripe/payouts')
    >()),
    payoutStripe,
    // The real check needs the stripe package, which only server-utils has.
    isConnectNotAllowed: (error: unknown) =>
      error instanceof Error && error.name === 'StripePermissionError',
    isInvalidRequest: (error: unknown) =>
      error instanceof Error && error.name === 'StripeInvalidRequestError',
    isResourceMissing: (error: unknown) =>
      error instanceof Error &&
      (error as { code?: string }).code === 'resource_missing',
  }),
);

import { PaymentAccountMismatchError } from '@discava/common-server-utils/stripe/payouts';
import { PaymentsNotConnectedError } from '@discava/common-server-utils/stripe/secrets';

const router = t.router({ account, startOnboarding, dashboardLink });

const SUB = 'instructor-1';
const ORIGIN = 'https://instructors.example.com';
const KEY = 'sk_test_secretkeyvalue';

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: SUB, groups, headers: { origin: ORIGIN } });

const active = { status: 'active', accountId: 'acct_p', mode: 'test' };
const stored = (status = 'in_progress') => ({
  instructorId: SUB,
  accountId: 'acct_p',
  mode: 'test',
  connectedAccountId: 'acct_i1',
  status,
});
const stripeAccount = (over = {}) => ({
  id: 'acct_i1',
  details_submitted: false,
  payouts_enabled: false,
  capabilities: { transfers: 'inactive' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ALLOWED_ORIGINS = ORIGIN;
  getConnection.mockResolvedValue(active);
  payoutGet.mockReturnValue({ go: async () => ({ data: null }) });
  payoutStripe.mockResolvedValue(stripe);
  saveAccountStatus.mockImplementation(async (r) => r);
  stripe.createExpressAccount.mockResolvedValue(stripeAccount());
  stripe.createAccountLink.mockResolvedValue({ url: 'https://stripe/onboard' });
  stripe.createLoginLink.mockResolvedValue({ url: 'https://stripe/dash' });
});

const storedIs = (record: unknown) =>
  payoutGet.mockReturnValue({ go: async () => ({ data: record }) });

describe('authorisation', () => {
  it.each([
    ['account', (c: ReturnType<typeof callAs>) => c.account()],
    [
      'startOnboarding',
      (c: ReturnType<typeof callAs>) => c.startOnboarding({ returnPath: '/x' }),
    ],
    ['dashboardLink', (c: ReturnType<typeof callAs>) => c.dashboardLink()],
  ])('%s is FORBIDDEN for a non-instructor', async (_n, run) => {
    await expect(run(callAs(['student']))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('payout.account', () => {
  it.each([
    ['no connection', undefined],
    ['a changing one', { ...active, status: 'changing' }],
    ['a disconnected one', { ...active, status: 'disconnected' }],
  ])('is unavailable with %s and calls no Stripe', async (_n, connection) => {
    getConnection.mockResolvedValue(connection);
    await expect(callAs().account()).resolves.toEqual({
      status: 'unavailable',
    });
    expect(payoutStripe).not.toHaveBeenCalled();
  });

  it('is not_started without a stored account, without calling Stripe', async () => {
    await expect(callAs().account()).resolves.toEqual({
      status: 'not_started',
    });
    expect(payoutStripe).not.toHaveBeenCalled();
  });

  it('looks the account up under the current payment account and the caller', async () => {
    await callAs().account();
    expect(payoutGet).toHaveBeenCalledWith({
      instructorId: SUB,
      accountId: 'acct_p',
      mode: 'test',
    });
  });

  it('follows Stripe and stores a changed status', async () => {
    storedIs(stored('in_progress'));
    stripe.retrieveAccount.mockResolvedValue(
      stripeAccount({
        details_submitted: true,
        payouts_enabled: true,
        capabilities: { transfers: 'active' },
      }),
    );
    await expect(callAs().account()).resolves.toEqual({ status: 'active' });
    expect(saveAccountStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId: SUB,
        connectedAccountId: 'acct_i1',
        status: 'active',
      }),
    );
  });

  it('does not write when the status is unchanged', async () => {
    storedIs(stored('in_progress'));
    stripe.retrieveAccount.mockResolvedValue(stripeAccount());
    await callAs().account();
    expect(saveAccountStatus).not.toHaveBeenCalled();
  });

  it('returns the stored status as stale when Stripe is down', async () => {
    storedIs(stored('active'));
    stripe.retrieveAccount.mockRejectedValue(new Error('down'));
    await expect(callAs().account()).resolves.toEqual({
      status: 'active',
      stale: true,
    });
  });

  it('returns the stored status as stale when the key no longer fits', async () => {
    storedIs(stored('restricted'));
    payoutStripe.mockRejectedValue(new PaymentAccountMismatchError());
    await expect(callAs().account()).resolves.toEqual({
      status: 'restricted',
      stale: true,
    });
  });

  it('is not_started after the connection moved to another account or mode', async () => {
    for (const moved of [
      { ...active, accountId: 'acct_new' },
      { ...active, mode: 'live' },
    ]) {
      getConnection.mockResolvedValue(moved);
      payoutGet.mockImplementation(
        ({ accountId, mode }: { accountId: string; mode: string }) => ({
          go: async () => ({
            data: accountId === 'acct_p' && mode === 'test' ? stored() : null,
          }),
        }),
      );
      await expect(callAs().account()).resolves.toEqual({
        status: 'not_started',
      });
    }
  });
});

describe('payout.startOnboarding', () => {
  const start = (returnPath = '/earnings') =>
    callAs().startOnboarding({ returnPath });

  it('is PRECONDITION_FAILED without an active connection, calling no Stripe', async () => {
    for (const connection of [
      undefined,
      { ...active, status: 'changing' },
      { ...active, status: 'disconnected' },
    ]) {
      getConnection.mockResolvedValue(connection);
      await expect(start()).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    }
    expect(payoutStripe).not.toHaveBeenCalled();
  });

  it('creates the account once, stores it and returns the link', async () => {
    await expect(start()).resolves.toEqual({ url: 'https://stripe/onboard' });
    expect(stripe.createExpressAccount).toHaveBeenCalledWith(SUB);
    expect(saveAccountStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        instructorId: SUB,
        accountId: 'acct_p',
        mode: 'test',
        connectedAccountId: 'acct_i1',
        status: 'in_progress',
      }),
    );
    expect(stripe.createAccountLink).toHaveBeenCalledWith({
      connectedAccountId: 'acct_i1',
      returnUrl: `${ORIGIN}/earnings`,
      refreshUrl: `${ORIGIN}/earnings`,
    });
  });

  it('reuses the stored account on a second call', async () => {
    storedIs(stored());
    await start();
    expect(stripe.createExpressAccount).not.toHaveBeenCalled();
    expect(stripe.createAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: 'acct_i1' }),
    );
  });

  it('gives concurrent first calls the same account', async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a).toEqual(b);
    const ids = new Set(
      saveAccountStatus.mock.calls.map((c) => c[0].connectedAccountId),
    );
    expect(ids).toEqual(new Set(['acct_i1']));
  });

  it('creates a new account beside the old one after the payment account moved', async () => {
    getConnection.mockResolvedValue({ ...active, accountId: 'acct_new' });
    await start();
    expect(saveAccountStatus).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct_new' }),
    );
  });

  it.each(['https://evil.example/x', '//evil.example', 'earnings', '/\\evil'])(
    'refuses the return path %s',
    async (path) => {
      await expect(start(path)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(stripe.createAccountLink).not.toHaveBeenCalled();
    },
  );

  it('turns a Stripe permission error into PRECONDITION_FAILED without the key', async () => {
    const denied = new Error(`key ${KEY} lacks permission`);
    denied.name = 'StripePermissionError';
    stripe.createExpressAccount.mockRejectedValue(denied);
    const error = (await start().catch((e) => e)) as Error;
    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(JSON.stringify(error) + error.message).not.toContain(KEY);
  });

  it('says the account is missing, not "Connect not enabled", on resource_missing', async () => {
    storedIs(stored());
    const gone = Object.assign(new Error('No such account'), {
      name: 'StripeInvalidRequestError',
      code: 'resource_missing',
    });
    stripe.createAccountLink.mockRejectedValue(gone);
    const error = (await start().catch((e) => e)) as Error;
    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(error.message).toContain("can't find your payout account");
    expect(error.message).not.toContain("can't set up payout accounts");
  });

  it('logs a rejected return URL with the Stripe code, not as "Connect not enabled"', async () => {
    storedIs(stored());
    const bad = Object.assign(new Error('Invalid URL'), {
      name: 'StripeInvalidRequestError',
      code: 'url_invalid',
    });
    stripe.createAccountLink.mockRejectedValue(bad);
    const logged: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (level) =>
        vi.spyOn(console, level).mockImplementation((...args) => {
          logged.push(args.map((a) => JSON.stringify(a)).join(' '));
        }),
    );
    const error = (await start().catch((e) => e)) as Error;
    for (const spy of spies) spy.mockRestore();
    expect(error.message).not.toContain("can't set up payout accounts");
    expect(
      logged.some((l) => l.includes('ERROR') && l.includes('url_invalid')),
    ).toBe(true);
  });

  it('is PRECONDITION_FAILED when the saved key is missing', async () => {
    payoutStripe.mockRejectedValue(new PaymentsNotConnectedError());
    await expect(start()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('never returns the key', async () => {
    const result = JSON.stringify(await start());
    expect(result).not.toContain('sk_');
  });
});

describe('payout.dashboardLink', () => {
  it('is PRECONDITION_FAILED before an account exists, or while in progress', async () => {
    await expect(callAs().dashboardLink()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    storedIs(stored('in_progress'));
    await expect(callAs().dashboardLink()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(stripe.createLoginLink).not.toHaveBeenCalled();
  });

  it('is PRECONDITION_FAILED without an active connection, calling no Stripe', async () => {
    getConnection.mockResolvedValue({ ...active, status: 'disconnected' });
    await expect(callAs().dashboardLink()).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(payoutStripe).not.toHaveBeenCalled();
  });

  it.each(['active', 'restricted'])('links an %s account', async (status) => {
    storedIs(stored(status));
    await expect(callAs().dashboardLink()).resolves.toEqual({
      url: 'https://stripe/dash',
    });
    expect(stripe.createLoginLink).toHaveBeenCalledWith('acct_i1');
  });
});

describe('the router', () => {
  it('has no procedure taking an instructor ID', async () => {
    const { appRouter } = await import('../router.js');
    const procedures = (appRouter as any)._def.procedures;
    for (const name of [
      'payout.account',
      'payout.startOnboarding',
      'payout.dashboardLink',
    ]) {
      const inputs = procedures[name]._def.inputs as {
        shape?: Record<string, unknown>;
      }[];
      for (const input of inputs) {
        expect(Object.keys(input.shape ?? {})).not.toContain('instructorId');
      }
    }
  });
});
