/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type CoreTable,
  refundUndeliverable,
  settleOrderPaid,
} from '@discava/core-table';
import type Stripe from 'stripe';
import type { WebhookDeps } from '../webhook-deps.js';

const paymentIntentOf = (session: Stripe.Checkout.Session) =>
  typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;

// Requests the full refund of a payment that can't be delivered. The key makes
// every attempt, including a retry of the whole event, the same refund.
const refund = async (
  deps: WebhookDeps,
  orderId: string,
  paymentIntentId: string | undefined,
) => {
  if (!paymentIntentId) {
    throw new Error(`Order ${orderId} was paid with no payment intent`);
  }
  await deps.withStripe((stripe) =>
    stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: `refund-${orderId}` },
    ),
  );
};

/**
 * `checkout.session.completed`: delivers a paid session's course, or refunds
 * it when it can't be delivered. An unknown order is logged and left alone;
 * any failure is thrown, so the answer is 500 and Stripe retries.
 */
export const handleSessionCompleted = async (
  event: Stripe.CheckoutSessionCompletedEvent,
  deps: WebhookDeps,
): Promise<void> => {
  const session = event.data.object;
  if (session.payment_status !== 'paid') return;

  const orderId = session.client_reference_id;
  const coreTable: CoreTable = await deps.getCoreTable();
  const order = orderId
    ? (await coreTable.entities.order.get({ orderId }).go()).data
    : null;
  if (!orderId || !order) {
    deps.logger.error('Paid session for an unknown order', {
      eventId: event.id,
      type: event.type,
      orderId,
    });
    return;
  }

  const paymentIntentId = paymentIntentOf(session);
  const mismatch =
    session.metadata?.orderId !== order.orderId ||
    session.metadata?.userId !== order.userId ||
    session.metadata?.courseId !== order.courseId ||
    session.amount_total !== order.amount ||
    session.currency?.toLowerCase() !== order.currency.toLowerCase();
  if (mismatch) {
    // The signature passed, so the money was taken: it is never kept.
    deps.logger.error('Paid session differs from its order; refunding', {
      eventId: event.id,
      type: event.type,
      orderId,
      expectedAmount: order.amount,
      expectedCurrency: order.currency,
      receivedAmount: session.amount_total,
      receivedCurrency: session.currency,
    });
    if (order.status === 'pending') {
      await refund(deps, orderId, paymentIntentId);
      await refundUndeliverable(coreTable, order, 'mismatch', deps.now());
    }
    return;
  }

  const settled = await settleOrderPaid({
    coreTable,
    order,
    paymentIntentId,
    now: deps.now(),
  });
  if (settled.result !== 'undeliverable') {
    deps.logger.info('Order settled', {
      eventId: event.id,
      type: event.type,
      orderId,
      result: settled.result,
    });
    return;
  }
  deps.logger.warn("Paid order can't be delivered; refunding", {
    eventId: event.id,
    type: event.type,
    orderId,
    reason: settled.reason,
  });
  await refund(deps, orderId, paymentIntentId);
  await refundUndeliverable(coreTable, order, settled.reason, deps.now());
};
