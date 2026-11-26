/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { markRefundFailed } from '@discava/core-table';
import type Stripe from 'stripe';
import type { WebhookDeps } from '../webhook-deps.js';

/**
 * `refund.failed`, or `charge.refund.updated` with `status: failed`: records
 * on the order its payment intent names that the refund failed, so the student
 * is told. The order stays `paid`. `markRefundFailed` leaves an order that was
 * refunded meanwhile, or never had a request, alone. An unknown order is
 * logged and answered 200; a failure is thrown, so the answer is 500 and
 * Stripe retries.
 */
export const handleRefundFailed = async (
  event: Stripe.RefundFailedEvent | Stripe.ChargeRefundUpdatedEvent,
  deps: WebhookDeps,
): Promise<void> => {
  const refund = event.data.object;
  if (refund.status !== 'failed') {
    deps.logger.info('Ignored a refund that did not fail', {
      eventId: event.id,
      type: event.type,
      status: refund.status,
    });
    return;
  }
  const paymentIntentId =
    typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id;
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
    deps.logger.error('Failed refund for an unknown order', {
      eventId: event.id,
      type: event.type,
      orderId,
    });
    return;
  }
  const recorded = await markRefundFailed({
    coreTable,
    order,
    now: deps.now(),
  });
  if (!recorded) return;
  deps.logger.info('Refund failure recorded', {
    eventId: event.id,
    type: event.type,
    orderId,
  });
};
