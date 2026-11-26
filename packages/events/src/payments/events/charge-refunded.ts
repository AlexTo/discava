/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { formatPrice } from '@discava/common-web-utils/price';
import { publishNotification, refundOrder } from '@discava/core-table';
import type Stripe from 'stripe';
import type { WebhookDeps } from '../webhook-deps.js';

/**
 * `charge.refunded`: records a refund against the order its payment intent
 * names. `refundOrder` ends the order and enrolment only on a full refund, and
 * leaves an order that is not `paid` (a repeat, or our own automatic refund)
 * alone. Every full-refund notice then tells the student, once, when the order
 * is `refunded` on request and their enrolment still names it: the
 * notification's key is the order, so a repeat is a duplicate, and a publish
 * that failed after the move is retried by the redelivered notice. An unknown order is logged and answered 200; a failure is thrown, so
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
    eventAt:
      typeof event.created === 'number'
        ? new Date(event.created * 1000).toISOString()
        : undefined,
  });
  await notifyStudent(order.orderId, coreTable);
  deps.logger.info('Refund recorded', {
    eventId: event.id,
    type: event.type,
    orderId,
    amountRefunded: charge.amount_refunded,
  });
};

// A publish error is not caught: the delivery fails and Stripe redelivers.
const notifyStudent = async (
  orderId: string,
  coreTable: Awaited<ReturnType<WebhookDeps['getCoreTable']>>,
) => {
  const { data: order } = await coreTable.entities.order.get({ orderId }).go();
  if (
    !order ||
    order.status !== 'refunded' ||
    order.refundReason !== 'requested' ||
    !order.refundedAt
  ) {
    return;
  }
  const { data: enrolment } = await coreTable.entities.enrolment
    .get({ courseId: order.courseId, userId: order.userId })
    .go();
  if (enrolment?.orderId !== orderId) return;
  await publishNotification(coreTable, {
    type: 'order.refunded',
    userId: order.userId,
    params: {
      courseTitle: order.courseTitle,
      courseId: order.courseId,
      amount: formatPrice(order.amount, order.currency),
    },
    dedupeKey: orderId,
    occurredAt: order.refundedAt,
  });
};
