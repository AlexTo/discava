/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The only code that knows the `order` record's shape for earnings: what an
 * order image says about a sale and about how much of it was refunded. The
 * image is the record's new image, as the stream delivers it.
 */
export type OrderImage = Record<string, unknown>;

export interface SaleInput {
  orderId: string;
  courseId: string;
  accountId: string;
  mode: 'test' | 'live';
  currency: string;
  listAmount: number;
  amount: number;
  paidAt: string;
}

export interface RefundInput {
  orderId: string;
  refundedTotal: number;
  occurredAt: string;
}

const amountOf = (value: unknown): number =>
  typeof value === 'number' ? value : 0;

/**
 * Whether the order is a sale: paid, or refunded because the buyer asked
 * (`requested`), and charged more than 0. An order refunded automatically as
 * undeliverable (`duplicate`, `unavailable`, `mismatch`) carries `paidAt` but
 * was never a sale.
 */
export const isSale = (order: OrderImage): boolean =>
  (order.status === 'paid' ||
    (order.status === 'refunded' && order.refundReason === 'requested')) &&
  amountOf(order.amount) > 0;

/** What the ledger needs to record the sale. Never carries the buyer. */
export const saleInput = (order: OrderImage): SaleInput => ({
  orderId: order.orderId as string,
  courseId: order.courseId as string,
  accountId: order.accountId as string,
  mode: order.mode as 'test' | 'live',
  currency: order.currency as string,
  listAmount: order.listAmount as number,
  amount: order.amount as number,
  paidAt: order.paidAt as string,
});

/**
 * The refunded total and when it happened (`refundedAt` on a refunded order,
 * otherwise the image's `updatedAt`), or nothing when no refund is recorded.
 */
export const refundInput = (order: OrderImage): RefundInput | undefined => {
  const refundedTotal = amountOf(order.refundedAmount);
  if (refundedTotal <= 0) {
    return undefined;
  }
  const occurredAt =
    order.status === 'refunded' && typeof order.refundedAt === 'string'
      ? order.refundedAt
      : (order.updatedAt as string);
  return { orderId: order.orderId as string, refundedTotal, occurredAt };
};
