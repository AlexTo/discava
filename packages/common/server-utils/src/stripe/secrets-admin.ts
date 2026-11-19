/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { dropStripeSecretCache, looksLikeStripeSecret } from './secrets.js';
import {
  readSecret,
  STRIPE_SECRET_PLACEHOLDER,
  writeSecret,
} from './secrets-store.js';

// The writers of the two Stripe secrets, for the admin function that connects
// and disconnects Stripe, and nothing else: only `PaymentsConnect` is granted
// write access when deployed, and checkout and the webhook import `secrets.ts`,
// which has no writer.

/**
 * Saves the signing secret and then the key, when given (a rotation writes the
 * key alone). The signing secret goes first, so a failure between the two
 * leaves the old key with a signing secret nothing else is using yet.
 */
export const writeStripeSecrets = async ({
  apiKey,
  webhookSecret,
}: {
  apiKey?: string;
  webhookSecret?: string;
}): Promise<void> => {
  try {
    if (webhookSecret !== undefined) {
      await writeSecret('webhook-secret', webhookSecret);
    }
    if (apiKey !== undefined) await writeSecret('api-key', apiKey);
  } finally {
    dropStripeSecretCache();
  }
};

/** Overwrites both secrets with a placeholder, as a disconnect does. */
export const clearStripeSecrets = async (): Promise<void> => {
  try {
    await writeSecret('webhook-secret', STRIPE_SECRET_PLACEHOLDER);
    await writeSecret('api-key', STRIPE_SECRET_PLACEHOLDER);
  } finally {
    dropStripeSecretCache();
  }
};

/**
 * The stored key, uncached, so a switch can remove the old registration with
 * it; `undefined` when none is saved.
 */
export const readStripeApiKey = async (): Promise<string | undefined> => {
  try {
    const value = await readSecret('api-key');
    return looksLikeStripeSecret('api-key', value) ? value : undefined;
  } catch (error) {
    if (error instanceof Error && error.name === 'PaymentsNotConnectedError') {
      return undefined;
    }
    throw error;
  }
};

/**
 * The stored signing secret, uncached, so a failed switch can put it back;
 * `undefined` when none is saved.
 */
export const readStripeWebhookSecret = async (): Promise<
  string | undefined
> => {
  try {
    const value = await readSecret('webhook-secret');
    return looksLikeStripeSecret('webhook-secret', value) ? value : undefined;
  } catch (error) {
    if (error instanceof Error && error.name === 'PaymentsNotConnectedError') {
      return undefined;
    }
    throw error;
  }
};
