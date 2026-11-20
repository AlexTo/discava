/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { refundOrder } from '@discava/core-table';
import type Stripe from 'stripe';
import type { WebhookDeps } from '../webhook-deps.js';

/**
 * `charge.refunded`: records a refund against the order its payment intent
 * names. `refundOrder` ends the order and enrolment only on a full refund, and
 * leaves an order that is not `paid` (a repeat, or our own automatic refund)
 * alone. An unknown order is logged and answered 200; a failure is thrown, so
 * the answer is 500 and Stripe retries.
 */
export const handleChargeRefunded = async (
  event: Stripe.ChargeRefundedEvent,
  deps: WebhookDeps,
): Promise<void> => {
  const charge = event.data.object;
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  const intent = paymentIntentId
    ? await deps.withStripe((stripe) =>
        stripe.paymentIntents.retrieve(paymentIntentId),
      )
    : undefined;
  const orderId = intent?.metadata?.orderId;
  const coreTable = await deps.getCoreTable();
  const order = orderId
    ? (await coreTable.entities.order.get({ orderId }).go()).data
    : null;
  if (!orderId || !order) {
    deps.logger.error('Refund for an unknown order', {
      eventId: event.id,
      type: event.type,
      orderId,
    });
    return;
  }
  await refundOrder({
    coreTable,
    order,
    refundedTotal: charge.amount_refunded,
    now: deps.now(),
  });
  deps.logger.info('Refund recorded', {
    eventId: event.id,
    type: event.type,
    orderId,
    amountRefunded: charge.amount_refunded,
  });
};
