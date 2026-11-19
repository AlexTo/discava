/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expireOrder } from '@discava/core-table';
import type Stripe from 'stripe';
import type { WebhookDeps } from '../webhook-deps.js';

/**
 * `checkout.session.expired`: closes the session's order. `expireOrder` moves
 * only a `pending` order, so a repeat or a paid order is left alone; an unknown
 * order is logged and answered 200.
 */
export const handleSessionExpired = async (
  event: Stripe.CheckoutSessionExpiredEvent,
  deps: WebhookDeps,
): Promise<void> => {
  const orderId = event.data.object.client_reference_id;
  const coreTable = await deps.getCoreTable();
  const order = orderId
    ? (await coreTable.entities.order.get({ orderId }).go()).data
    : null;
  if (!orderId || !order) {
    deps.logger.error('Expired session for an unknown order', {
      eventId: event.id,
      type: event.type,
      orderId,
    });
    return;
  }
  await expireOrder(coreTable, order);
  deps.logger.info('Order expired', {
    eventId: event.id,
    type: event.type,
    orderId,
  });
};
