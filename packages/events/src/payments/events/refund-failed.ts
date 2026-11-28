/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  markRefundFailed,
  publishNotification,
  reverseRefund,
} from '@discava/core-table';
import type Stripe from 'stripe';
import type { WebhookDeps } from '../webhook-deps.js';

/**
 * `refund.failed`, or `charge.refund.updated` with `status: failed`: records
 * on the order its payment intent names that the refund failed. An order still
 * `paid` only gets `refundFailedAt` (`markRefundFailed`, which leaves an order
 * with no request alone). An order `charge.refunded` already moved to
 * `refunded` is undone by `reverseRefund`: it is `paid` again and the
 * enrolment is restored, and the student is told (the notification's key is
 * the order, so a repeat is a duplicate). If the student bought the course
 * again, the order stays `refunded` and only gets `refundFailedAt`; the
 * student is told the money didn't come back and to contact support. An unknown order is logged and
 * answered 200; a failure is thrown, so the answer is 500 and Stripe retries.
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
  const now = deps.now();
  const outcome =
    order.status === 'refunded'
      ? await reverseRefund({ coreTable, order, now })
      : (await markRefundFailed({ coreTable, order, now })) && 'marked';
  if (!outcome) return;
  if (outcome !== 'marked') {
    // A publish error is not caught: the delivery fails and Stripe redelivers.
    await publishNotification(coreTable, {
      type:
        outcome === 'repurchased'
          ? 'order.refund_failed_repurchased'
          : 'order.refund_failed',
      userId: order.userId,
      params: { courseTitle: order.courseTitle, courseId: order.courseId },
      dedupeKey: orderId,
      occurredAt: now,
    });
  }
  deps.logger.info('Refund failure recorded', {
    eventId: event.id,
    type: event.type,
    orderId,
  });
};
