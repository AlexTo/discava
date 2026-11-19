/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import Stripe from 'stripe';
import { isLocalDev, LOCAL_STRIPE } from '../local-dev.js';
import { dropStripeSecretCache, getStripeApiKey } from './secrets.js';

// The API version every Stripe object here is read as, pinned to the one the
// installed SDK's types describe, and the version a registered webhook
// endpoint sends events in.
export const STRIPE_API_VERSION = '2026-10-28.endive' as const;

/** Where the SDK connects: Stripe, or the local stand-in in local dev. */
export const stripeHostConfig = ():
  | { host: string; port: number; protocol: 'http' }
  | Record<string, never> =>
  isLocalDev()
    ? {
        host: LOCAL_STRIPE.host,
        port: LOCAL_STRIPE.port,
        protocol: LOCAL_STRIPE.protocol,
      }
    : {};

/** A Stripe client for a key given here, not the stored one. */
export const createStripe = (apiKey: string): Stripe =>
  new Stripe(apiKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    ...stripeHostConfig(),
  });

let cached: { apiKey: string; stripe: Stripe } | undefined;

/** The client for the saved key, built once per key. */
export const stripeClient = async (): Promise<Stripe> => {
  const apiKey = await getStripeApiKey();
  if (cached?.apiKey !== apiKey)
    cached = { apiKey, stripe: createStripe(apiKey) };
  return cached.stripe;
};

/**
 * Runs a call with the saved key's client. If Stripe rejects the key (it was
 * rotated since this process read it), the cached key is dropped and the call
 * is made once more with the current one.
 */
export const withStripe = async <T>(
  call: (stripe: Stripe) => Promise<T>,
): Promise<T> => {
  try {
    return await call(await stripeClient());
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeAuthenticationError))
      throw error;
    dropStripeSecretCache();
    cached = undefined;
    return call(await stripeClient());
  }
};

export const dropStripeClient = (): void => {
  cached = undefined;
};
