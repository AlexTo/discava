/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { stripe } = vi.hoisted(() => ({
  stripe: {
    accounts: { retrieveCurrent: vi.fn() },
    webhookEndpoints: { create: vi.fn(), list: vi.fn(), del: vi.fn() },
  },
}));
vi.mock('./client.js', () => ({
  createStripe: vi.fn(() => stripe),
  STRIPE_API_VERSION: '2026-10-28.endive',
}));

import { createStripe } from './client.js';
import {
  CONNECT_MESSAGES,
  ConnectError,
  registerEndpoint,
  removeEndpoint,
  removeLeftoverEndpoints,
  verifyKey,
} from './connect.js';

const KEY = 'sk_test_abcdefghij1234';
const URL = 'https://api.example.com/stripe/webhook';

const authError = () =>
  new Stripe.errors.StripeAuthenticationError({
    message: `Invalid API Key provided: ${KEY}`,
    type: 'invalid_request_error',
  } as never);
const permissionError = () =>
  new Stripe.errors.StripePermissionError({
    message: `The key ${KEY} lacks permission`,
    type: 'invalid_request_error',
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
});

const failure = async (run: () => Promise<unknown>) => {
  const error = (await run().catch((e) => e)) as ConnectError;
  expect(error).toBeInstanceOf(ConnectError);
  expect(JSON.stringify(error)).not.toContain(KEY);
  expect(String(error.message)).not.toContain(KEY);
  expect(String(error.stack)).not.toContain(KEY);
  return error as ConnectError;
};

describe('verifyKey', () => {
  it.each([
    ['sk_test_abc123', 'test'],
    ['sk_live_abc123', 'live'],
    ['rk_test_abc123', 'test'],
    ['rk_live_abc123', 'live'],
    ['sk_test_local_2', 'test'],
  ] as const)(
    'accepts %s and reads the mode from the prefix',
    async (key, mode) => {
      stripe.accounts.retrieveCurrent.mockResolvedValue({
        id: 'acct_1',
        business_profile: { name: 'Acme' },
      });
      expect(await verifyKey(key)).toEqual({
        mode,
        accountId: 'acct_1',
        accountName: 'Acme',
        keyLast4: key.slice(-4),
      });
      expect(createStripe).toHaveBeenCalledWith(key);
    },
  );

  it('falls back to the dashboard name, then the account ID', async () => {
    stripe.accounts.retrieveCurrent.mockResolvedValue({
      id: 'acct_1',
      settings: { dashboard: { display_name: 'Dash' } },
    });
    expect((await verifyKey(KEY)).accountName).toBe('Dash');
    stripe.accounts.retrieveCurrent.mockResolvedValue({ id: 'acct_1' });
    expect((await verifyKey(KEY)).accountName).toBe('acct_1');
  });

  it('rejects a publishable key and malformed input with fixed messages, without calling Stripe', async () => {
    const pk = 'pk_test_publishable123';
    const publishable = await verifyKey(pk).catch((e) => e);
    expect(publishable.message).toBe(CONNECT_MESSAGES.publishableKey);
    expect(publishable.message).not.toContain(pk);
    for (const bad of [
      '',
      'sk_test_',
      'whsec_abc',
      'sk_demo_abc',
      ' sk_test_abc',
      'hello world',
    ]) {
      const error = await verifyKey(bad).catch((e) => e);
      expect(error).toBeInstanceOf(ConnectError);
      expect(error.message).toBe(CONNECT_MESSAGES.notAKey);
      expect(error.code).toBe('BAD_REQUEST');
    }
    expect(createStripe).not.toHaveBeenCalled();
  });

  it('maps Stripe’s authentication and permission errors, never echoing the key', async () => {
    stripe.accounts.retrieveCurrent.mockRejectedValue(authError());
    const rejected = await failure(() => verifyKey(KEY));
    expect(rejected.message).toBe(CONNECT_MESSAGES.rejected);
    expect(rejected.code).toBe('BAD_REQUEST');

    stripe.accounts.retrieveCurrent.mockRejectedValue(permissionError());
    const denied = await failure(() => verifyKey(KEY));
    expect(denied.message).toBe(CONNECT_MESSAGES.noAccountPermission);
  });

  it('reports an unreachable Stripe as a server error', async () => {
    stripe.accounts.retrieveCurrent.mockRejectedValue(
      new Error(`ECONNRESET ${KEY}`),
    );
    const error = await failure(() => verifyKey(KEY));
    expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe(CONNECT_MESSAGES.unreachable);
  });
});

describe('registerEndpoint', () => {
  it('sends exactly the five events, the stage and the pinned version, and returns the id and secret', async () => {
    stripe.webhookEndpoints.create.mockResolvedValue({
      id: 'we_1',
      secret: 'whsec_x',
    });
    expect(
      await registerEndpoint({ secretKey: KEY, url: URL, stage: 'dev' }),
    ).toEqual({
      id: 'we_1',
      secret: 'whsec_x',
    });
    expect(stripe.webhookEndpoints.create).toHaveBeenCalledWith({
      url: URL,
      enabled_events: [
        'checkout.session.completed',
        'checkout.session.expired',
        'charge.refunded',
        'refund.failed',
        'charge.refund.updated',
      ],
      api_version: '2026-10-28.endive',
      metadata: { app: 'discava', stage: 'dev' },
    });
  });

  it('maps a permission error, an unusable key and any other failure', async () => {
    stripe.webhookEndpoints.create.mockRejectedValue(permissionError());
    expect(
      (
        await failure(() =>
          registerEndpoint({ secretKey: KEY, url: URL, stage: 's' }),
        )
      ).message,
    ).toBe(CONNECT_MESSAGES.noPermission);
    stripe.webhookEndpoints.create.mockRejectedValue(authError());
    expect(
      (
        await failure(() =>
          registerEndpoint({ secretKey: KEY, url: URL, stage: 's' }),
        )
      ).message,
    ).toBe(CONNECT_MESSAGES.rejected);
    stripe.webhookEndpoints.create.mockRejectedValue(new Error(KEY));
    const other = await failure(() =>
      registerEndpoint({ secretKey: KEY, url: URL, stage: 's' }),
    );
    expect(other.message).toBe(CONNECT_MESSAGES.registration);
    expect(other.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('fails when Stripe returns no signing secret', async () => {
    stripe.webhookEndpoints.create.mockResolvedValue({ id: 'we_1' });
    expect(
      (
        await failure(() =>
          registerEndpoint({ secretKey: KEY, url: URL, stage: 's' }),
        )
      ).step,
    ).toBe('registration');
  });
});

describe('removeLeftoverEndpoints', () => {
  async function* list(...endpoints: unknown[]) {
    yield* endpoints;
  }

  it('deletes only endpoints at our URL with our metadata', async () => {
    const ours = {
      id: 'we_ours',
      url: URL,
      metadata: { app: 'discava', stage: 'dev' },
    };
    stripe.webhookEndpoints.list.mockReturnValue(
      list(
        ours,
        {
          id: 'we_other_url',
          url: 'https://other',
          metadata: { app: 'discava', stage: 'dev' },
        },
        { id: 'we_no_meta', url: URL, metadata: {} },
        {
          id: 'we_other_stage',
          url: URL,
          metadata: { app: 'discava', stage: 'prod' },
        },
        {
          id: 'we_foreign',
          url: URL,
          metadata: { app: 'someone-else', stage: 'dev' },
        },
      ),
    );
    expect(
      await removeLeftoverEndpoints({ secretKey: KEY, url: URL, stage: 'dev' }),
    ).toBe(1);
    expect(stripe.webhookEndpoints.del).toHaveBeenCalledTimes(1);
    expect(stripe.webhookEndpoints.del).toHaveBeenCalledWith('we_ours');
  });

  it('fails with a fixed message', async () => {
    stripe.webhookEndpoints.list.mockImplementation(() => {
      throw new Error(KEY);
    });
    const error = await failure(() =>
      removeLeftoverEndpoints({ secretKey: KEY, url: URL, stage: 'dev' }),
    );
    expect(error.message).toBe(CONNECT_MESSAGES.registration);
  });
});

describe('removeEndpoint', () => {
  it('deletes and reports success', async () => {
    stripe.webhookEndpoints.del.mockResolvedValue({});
    expect(await removeEndpoint({ secretKey: KEY, endpointId: 'we_1' })).toBe(
      true,
    );
    expect(stripe.webhookEndpoints.del).toHaveBeenCalledWith('we_1');
  });

  it('swallows a failure and reports it', async () => {
    stripe.webhookEndpoints.del.mockRejectedValue(new Error(KEY));
    expect(await removeEndpoint({ secretKey: KEY, endpointId: 'we_1' })).toBe(
      false,
    );
  });
});
