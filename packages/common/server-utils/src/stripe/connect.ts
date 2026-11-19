/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import Stripe from 'stripe';
import { createStripe, STRIPE_API_VERSION } from './client.js';

// What an administrator's save needs from Stripe (research R-14): check a
// pasted key, register our confirmation address with it, and clean up
// registrations. Every function takes the key to use as an argument, not the
// stored one, since a save works with a key not yet stored (or one being
// replaced). Errors are `ConnectError`s with a fixed message: no key, and no
// text from Stripe, is ever in a thrown value or a log line.

/** The events the webhook handles, and the only ones registered. */
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'charge.refunded',
] as const;

export const CONNECT_MESSAGES = {
  notAKey: "This isn't a Stripe secret key",
  publishableKey: "That's a publishable key; paste the secret key",
  rejected: 'Stripe rejected this key',
  noPermission: "This key can't create webhook endpoints",
  noAccountPermission: "This key can't read the Stripe account",
  unreachable: "Couldn't reach Stripe; nothing was changed",
  registration:
    "Couldn't register the confirmation address; nothing was changed",
} as const;

export type ConnectStep = 'key' | 'account' | 'registration';

export class ConnectError extends Error {
  constructor(
    message: string,
    /** The tRPC code the caller maps it to. */
    readonly code: 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR',
    /** Which step of the save failed, for the audit row. */
    readonly step: ConnectStep,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

const KEY_PATTERN = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/;

export interface VerifiedKey {
  mode: 'test' | 'live';
  accountId: string;
  accountName: string;
  /** The last four characters, for display. */
  keyLast4: string;
}

/** The mode of a secret key from its prefix, or a `ConnectError` if it isn't one. */
export const keyMode = (secretKey: string): 'test' | 'live' => {
  const match = KEY_PATTERN.exec(secretKey);
  if (!match) {
    throw new ConnectError(
      /^pk_(?:test|live)_/.test(secretKey)
        ? CONNECT_MESSAGES.publishableKey
        : CONNECT_MESSAGES.notAKey,
      'BAD_REQUEST',
      'key',
    );
  }
  return match[1] as 'test' | 'live';
};

/**
 * Checks the key's shape, then asks Stripe whose it is. Returns the mode, the
 * account's ID and name and the key's last four characters.
 */
export const verifyKey = async (secretKey: string): Promise<VerifiedKey> => {
  const mode = keyMode(secretKey);
  try {
    const account = await createStripe(secretKey).accounts.retrieveCurrent();
    return {
      mode,
      accountId: account.id,
      accountName:
        account.business_profile?.name ||
        account.settings?.dashboard?.display_name ||
        account.id,
      keyLast4: secretKey.slice(-4),
    };
  } catch (error) {
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      throw new ConnectError(CONNECT_MESSAGES.rejected, 'BAD_REQUEST', 'key');
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      throw new ConnectError(
        CONNECT_MESSAGES.noAccountPermission,
        'BAD_REQUEST',
        'account',
      );
    }
    throw new ConnectError(
      CONNECT_MESSAGES.unreachable,
      'INTERNAL_SERVER_ERROR',
      'account',
    );
  }
};

const METADATA_APP = 'discava';

/**
 * Registers `url` as a webhook endpoint of the key's account, for exactly the
 * three events and the API version the SDK is pinned to. Returns the
 * endpoint's ID and signing secret, which Stripe reveals only now.
 */
export const registerEndpoint = async ({
  secretKey,
  url,
  stage,
}: {
  secretKey: string;
  url: string;
  stage: string;
}): Promise<{ id: string; secret: string }> => {
  try {
    const endpoint = await createStripe(secretKey).webhookEndpoints.create({
      url,
      enabled_events: [...WEBHOOK_EVENTS],
      api_version: STRIPE_API_VERSION,
      metadata: { app: METADATA_APP, stage },
    });
    if (!endpoint.secret) throw new Error('no secret');
    return { id: endpoint.id, secret: endpoint.secret };
  } catch (error) {
    if (error instanceof Stripe.errors.StripePermissionError) {
      throw new ConnectError(
        CONNECT_MESSAGES.noPermission,
        'BAD_REQUEST',
        'registration',
      );
    }
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      throw new ConnectError(CONNECT_MESSAGES.rejected, 'BAD_REQUEST', 'key');
    }
    throw new ConnectError(
      CONNECT_MESSAGES.registration,
      'INTERNAL_SERVER_ERROR',
      'registration',
    );
  }
};

/**
 * Deletes endpoints of the key's account that a crashed earlier save may have
 * left: ours (by metadata) at the same address. Anything else the account has
 * registered is untouched. Returns how many it removed.
 */
export const removeLeftoverEndpoints = async ({
  secretKey,
  url,
  stage,
}: {
  secretKey: string;
  url: string;
  stage: string;
}): Promise<number> => {
  try {
    const stripe = createStripe(secretKey);
    let removed = 0;
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (
        endpoint.url === url &&
        endpoint.metadata?.app === METADATA_APP &&
        endpoint.metadata?.stage === stage
      ) {
        await stripe.webhookEndpoints.del(endpoint.id);
        removed++;
      }
    }
    return removed;
  } catch {
    throw new ConnectError(
      CONNECT_MESSAGES.registration,
      'INTERNAL_SERVER_ERROR',
      'registration',
    );
  }
};

/**
 * Deletes one endpoint with the key it was registered with. Best effort: a
 * failure is swallowed and reported as `false`, never undoing the change that
 * called it.
 */
export const removeEndpoint = async ({
  secretKey,
  endpointId,
}: {
  secretKey: string;
  endpointId: string;
}): Promise<boolean> => {
  try {
    await createStripe(secretKey).webhookEndpoints.del(endpointId);
    return true;
  } catch {
    return false;
  }
};
