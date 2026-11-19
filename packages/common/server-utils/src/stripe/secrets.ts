/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  PaymentsNotConnectedError,
  readSecret,
  type StripeSecretName,
} from './secrets-store.js';

// What checkout and the webhook read: the Stripe secret key and the webhook
// signing secret an administrator saved. Read only; the writers are in
// `secrets-admin.ts`, which only the admin function imports. A value is cached
// for five minutes, and `dropStripeSecretCache` forgets it so a rotated one is
// picked up at once. A secret that doesn't look like a key (the deployment's
// empty one, or one overwritten on disconnect) reads as "not connected".

export { PaymentsNotConnectedError };

export const STRIPE_SECRET_CACHE_MS = 5 * 60 * 1000;

const SHAPE: Record<StripeSecretName, RegExp> = {
  'api-key': /^(?:sk|rk)_(?:test|live)_\w+$/,
  'webhook-secret': /^whsec_\w+$/,
};

const cache = new Map<StripeSecretName, { value: string; readAt: number }>();

const get = async (name: StripeSecretName): Promise<string> => {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.readAt < STRIPE_SECRET_CACHE_MS) {
    return cached.value;
  }
  const value = await readSecret(name);
  if (!value || !SHAPE[name].test(value)) {
    cache.delete(name);
    throw new PaymentsNotConnectedError();
  }
  cache.set(name, { value, readAt: Date.now() });
  return value;
};

/** The saved Stripe secret key; throws `PaymentsNotConnectedError` if none. */
export const getStripeApiKey = (): Promise<string> => get('api-key');

/** The saved webhook signing secret; throws if none. */
export const getStripeWebhookSecret = (): Promise<string> =>
  get('webhook-secret');

/** Forgets both cached values, so the next read goes to the store. */
export const dropStripeSecretCache = (): void => {
  cache.clear();
};

/** Whether text has the shape of a Stripe secret of that kind. */
export const looksLikeStripeSecret = (
  name: StripeSecretName,
  value: string | undefined,
): value is string => value !== undefined && SHAPE[name].test(value);
