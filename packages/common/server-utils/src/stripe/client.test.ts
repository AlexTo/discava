/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getKey, drop } = vi.hoisted(() => ({ getKey: vi.fn(), drop: vi.fn() }));
vi.mock('./secrets.js', () => ({
  getStripeApiKey: getKey,
  dropStripeSecretCache: drop,
}));

import {
  createStripe,
  dropStripeClient,
  STRIPE_API_VERSION,
  stripeClient,
  stripeHostConfig,
  withStripe,
} from './client.js';

beforeEach(() => {
  vi.clearAllMocks();
  dropStripeClient();
  getKey.mockResolvedValue('sk_test_one');
});
afterEach(() => vi.unstubAllEnvs());

describe('stripeHostConfig', () => {
  it('is the stand-in only in local dev', () => {
    vi.stubEnv('LOCAL_DEV', 'true');
    expect(stripeHostConfig()).toEqual({
      host: '127.0.0.1',
      port: 2024,
      protocol: 'http',
    });
    vi.stubEnv('LOCAL_DEV', undefined);
    expect(stripeHostConfig()).toEqual({});
  });
});

describe('stripeClient', () => {
  it('builds the client once for a key, and again when the key changes', async () => {
    const first = await stripeClient();
    expect(await stripeClient()).toBe(first);
    getKey.mockResolvedValue('sk_test_two');
    expect(await stripeClient()).not.toBe(first);
  });

  it('pins the API version and retries network failures', () => {
    const stripe = createStripe('sk_test_one') as unknown as {
      getApiField: (name: string) => unknown;
      getMaxNetworkRetries: () => number;
    };
    expect(stripe.getApiField('version')).toBe(STRIPE_API_VERSION);
    expect(stripe.getMaxNetworkRetries()).toBe(2);
  });
});

describe('withStripe', () => {
  const authError = () =>
    new Stripe.errors.StripeAuthenticationError({
      message: 'Invalid API Key',
      type: 'invalid_request_error',
    } as never);

  it('drops the key cache after an authentication error and retries once', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(authError())
      .mockResolvedValueOnce('ok');
    getKey
      .mockResolvedValueOnce('sk_test_old')
      .mockResolvedValue('sk_test_new');

    await expect(withStripe(call)).resolves.toBe('ok');
    expect(drop).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]?.[0]).not.toBe(call.mock.calls[1]?.[0]);
  });

  it('gives up after the one retry', async () => {
    const call = vi.fn().mockRejectedValue(authError());
    await expect(withStripe(call)).rejects.toBeInstanceOf(
      Stripe.errors.StripeAuthenticationError,
    );
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('leaves any other error alone', async () => {
    const call = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withStripe(call)).rejects.toThrow('boom');
    expect(call).toHaveBeenCalledTimes(1);
    expect(drop).not.toHaveBeenCalled();
  });
});
