/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  dropStripeSecretCache,
  getStripeWebhookSecret,
  PaymentsNotConnectedError,
} from '@discava/common-server-utils/stripe/secrets';
import Stripe from 'stripe';
import { handleChargeRefunded } from './events/charge-refunded.js';
import { handleRefundFailed } from './events/refund-failed.js';
import { handleSessionCompleted } from './events/session-completed.js';
import { handleSessionExpired } from './events/session-expired.js';
import { defaultWebhookDeps, type WebhookDeps } from './webhook-deps.js';

// The messages older than this are refused, as Stripe's libraries advise.
const TOLERANCE_SECONDS = 300;

export interface WebhookResponse {
  status: 200 | 400 | 500;
}

// The signature is the only gate (the connection record is not read): with
// nothing connected there is no secret, so a message that still arrives fails
// like any other bad signature.
const verify = async (
  rawBody: string | Buffer,
  signature: string,
): Promise<Stripe.Event> => {
  try {
    return Stripe.webhooks.constructEvent(
      rawBody,
      signature,
      await getStripeWebhookSecret(),
      TOLERANCE_SECONDS,
    );
  } catch (error) {
    if (
      error instanceof PaymentsNotConnectedError ||
      !(error instanceof Stripe.errors.StripeSignatureVerificationError)
    ) {
      throw error;
    }
    // A secret rotated since this process read it: read it once more.
    dropStripeSecretCache();
    return Stripe.webhooks.constructEvent(
      rawBody,
      signature,
      await getStripeWebhookSecret(),
      TOLERANCE_SECONDS,
    );
  }
};

/**
 * Verifies a Stripe message against its exact bytes and applies it: 400 when
 * it can't be verified (nothing changed), 500 when handling it failed and
 * Stripe should retry, 200 otherwise (handled, duplicate, unmatched or an
 * event we don't act on).
 */
export const handleStripeWebhook = async (
  rawBody: string | Buffer,
  signature: string | undefined,
  deps: WebhookDeps = defaultWebhookDeps(),
): Promise<WebhookResponse> => {
  if (!signature) return { status: 400 };

  let event: Stripe.Event;
  try {
    event = await verify(rawBody, signature);
  } catch (error) {
    if (
      error instanceof PaymentsNotConnectedError ||
      error instanceof Stripe.errors.StripeSignatureVerificationError
    ) {
      deps.logger.warn('Refused a Stripe message', { reason: error.name });
      return { status: 400 };
    }
    deps.logger.error('Could not verify a Stripe message', {
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { status: 500 };
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleSessionCompleted(event, deps);
    } else if (event.type === 'checkout.session.expired') {
      await handleSessionExpired(event, deps);
    } else if (event.type === 'charge.refunded') {
      await handleChargeRefunded(event, deps);
    } else if (
      event.type === 'refund.failed' ||
      event.type === 'charge.refund.updated'
    ) {
      await handleRefundFailed(event, deps);
    } else {
      deps.logger.info('Ignored a Stripe event', {
        eventId: event.id,
        type: event.type,
      });
    }
    return { status: 200 };
  } catch (error) {
    deps.logger.error('Could not handle a Stripe event', {
      eventId: event.id,
      type: event.type,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return { status: 500 };
  }
};
