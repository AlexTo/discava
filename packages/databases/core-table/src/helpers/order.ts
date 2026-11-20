/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { v7 as uuidv7 } from 'uuid';
import type { OrderRefundReason, OrderStatus } from '../entities/order.js';
import type { PaymentMode } from '../entities/payment-connection.js';
import type { createCoreTableService } from '../service.js';
import { InvalidRequestError, NotFoundError } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `order`, and of `enrolment.orderId` and the paid-restore,
// free-restore and refund-end enrolment writes. Every move is a conditional
// write on the status it comes from, so a repeated or racing call changes
// nothing. None of it calls Stripe: the caller does that before or after.

/** How long a checkout lives, and how long before its end it stops being reused. */
export const CHECKOUT_TTL_SECONDS = 60 * 60;
export const CHECKOUT_REUSE_MARGIN_SECONDS = 5 * 60;

/** How long after paying a student may ask for a refund. */
export const REFUND_WINDOW_DAYS = 14;

// Starting a checkout, or settling a paid one, kept losing to other writers.
const ATTEMPTS = 3;

export interface OrderRecord {
  orderId: string;
  userId: string;
  courseId: string;
  accountId: string;
  mode: PaymentMode;
  courseTitle: string;
  listAmount: number;
  amount: number;
  currency: string;
  status: OrderStatus;
  expiresAt: string;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  paymentIntentId?: string;
  paidAt?: string;
  refundedAt?: string;
  refundedAmount?: number;
  refundReason?: OrderRefundReason;
  refundRequestedAt?: string;
}

export interface OrderCourse {
  courseId: string;
  title: string;
  status: string;
  priceAmount: number;
  priceCurrency: string;
}

/** The part of the connection record a checkout needs. */
export interface OrderConnection {
  status: string;
  accountId?: string;
  mode?: PaymentMode;
  latestCheckoutExpiresAt?: string;
}

/** Payments aren't connected (or are being changed): no checkout can start. */
export class PaymentsUnavailableError extends Error {
  constructor(message = 'payments-unavailable') {
    super(message);
    this.name = 'payments-unavailable';
  }
}

const plusSeconds = (iso: string, seconds: number) =>
  new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

/** The last moment a student may ask to refund an order paid at `paidAt`. */
export const refundDeadline = (paidAt: string) =>
  plusSeconds(paidAt, REFUND_WINDOW_DAYS * 24 * 60 * 60);

const later = (a: string | undefined, b: string) =>
  a !== undefined && a > b ? a : b;

const get = async (coreTable: CoreTable, orderId: string) =>
  (await coreTable.entities.order.get({ orderId }).go())
    .data as OrderRecord | null;

/**
 * Starts a checkout: one transaction that creates a `pending` order and
 * raises the connection's `latestCheckoutExpiresAt` to cover it, on the
 * condition that the connection is `active` and that value is still the one
 * read. Refuses a free or unpublished course (nothing written) and throws
 * `payments-unavailable` when the connection isn't active.
 */
export const startOrder = async ({
  coreTable,
  course,
  userId,
  now,
  getConnection,
  ttlSeconds = CHECKOUT_TTL_SECONDS,
}: {
  coreTable: CoreTable;
  course: OrderCourse;
  userId: string;
  now: string;
  /** Reads the connection record (payment-connection.ts' getConnection). */
  getConnection: () => Promise<OrderConnection | undefined>;
  /** Local development shortens a checkout's life; nothing else does. */
  ttlSeconds?: number;
}): Promise<OrderRecord> => {
  if (course.priceAmount === 0) {
    throw new InvalidRequestError('This course is free');
  }
  if (course.status !== 'published') throw new NotFoundError();

  const expiresAt = plusSeconds(now, ttlSeconds);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const connection = await getConnection();
    if (
      !connection ||
      connection.status !== 'active' ||
      !connection.accountId ||
      !connection.mode
    ) {
      throw new PaymentsUnavailableError();
    }
    const read = connection.latestCheckoutExpiresAt;
    const order: OrderRecord = {
      orderId: uuidv7(),
      userId,
      courseId: course.courseId,
      accountId: connection.accountId,
      mode: connection.mode,
      courseTitle: course.title,
      listAmount: course.priceAmount,
      amount: course.priceAmount,
      currency: course.priceCurrency,
      status: 'pending',
      expiresAt,
    };
    // `revision` is left alone: it orders the administrator's own writes, and
    // every checkout bumping it would make each key rotation lose.
    const { canceled } = await coreTable.transaction
      .write(({ order: orders, paymentConnection }) => [
        orders.create(order).commit(),
        paymentConnection
          .patch({})
          .set({ latestCheckoutExpiresAt: later(read, expiresAt) })
          .where((attr, op) =>
            read === undefined
              ? `${op.eq(attr.status, 'active')} AND ${op.notExists(attr.latestCheckoutExpiresAt)}`
              : `${op.eq(attr.status, 'active')} AND ${op.eq(attr.latestCheckoutExpiresAt, read)}`,
          )
          .commit(),
      ])
      .go();
    if (!canceled) return order;
  }
  throw new Error('Could not start the checkout; try again');
};

/** Records the Stripe session on a `pending` order; false if it is no longer pending. */
export const attachCheckoutSession = async (
  coreTable: CoreTable,
  order: Pick<OrderRecord, 'orderId'>,
  { sessionId, url }: { sessionId: string; url: string },
): Promise<boolean> => {
  try {
    await coreTable.entities.order
      .patch({ orderId: order.orderId })
      .set({ checkoutSessionId: sessionId, checkoutUrl: url })
      .where((attr, op) => op.eq(attr.status, 'pending'))
      .go();
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
};

const isConditionalFailure = (error: unknown) =>
  error instanceof Error &&
  'cause' in error &&
  error.cause instanceof Error &&
  error.cause.name === 'ConditionalCheckFailedException';

/**
 * The student's `pending` order for the course that has a session and more
 * than five minutes left, so a repeated Buy now reuses it. A pending order
 * past `expiresAt` counts as closed.
 */
export const findOpenOrder = async ({
  coreTable,
  userId,
  courseId,
  now,
}: {
  coreTable: CoreTable;
  userId: string;
  courseId: string;
  now: string;
}): Promise<OrderRecord | undefined> => {
  const { data } = await coreTable.entities.order.query
    .byStudentCourse({ userId, courseId })
    .go({ pages: 'all' });
  const cutoff = plusSeconds(now, CHECKOUT_REUSE_MARGIN_SECONDS);
  return (data as OrderRecord[])
    .filter(
      (order) =>
        order.status === 'pending' &&
        order.checkoutSessionId !== undefined &&
        order.expiresAt > cutoff,
    )
    .sort((a, b) => (a.orderId < b.orderId ? 1 : -1))[0];
};

export type SettleResult =
  | { result: 'fulfilled' }
  | { result: 'already-settled' }
  | { result: 'undeliverable'; reason: 'duplicate' | 'unavailable' };

/**
 * Moves a `pending` order to `paid` and gives the student their enrolment
 * (created, or restored from `dropped`) in one transaction that also checks
 * the course is published. When the order can't be delivered, nothing is
 * written and the caller refunds. A cancelled transaction is read again and
 * decided again, at most three times.
 */
export const settleOrderPaid = async ({
  coreTable,
  order: named,
  paymentIntentId,
  now,
}: {
  coreTable: CoreTable;
  order: Pick<OrderRecord, 'orderId'>;
  paymentIntentId?: string;
  now: string;
}): Promise<SettleResult> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const order = await get(coreTable, named.orderId);
    if (!order) throw new NotFoundError();
    if (order.status !== 'pending') return { result: 'already-settled' };

    const { courseId, userId } = order;
    const [{ data: course }, { data: enrolment }] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.enrolment.get({ courseId, userId }).go(),
    ]);
    if (!course || course.status !== 'published') {
      return { result: 'undeliverable', reason: 'unavailable' };
    }
    if (enrolment && enrolment.status !== 'dropped') {
      return { result: 'undeliverable', reason: 'duplicate' };
    }

    const { canceled } = await coreTable.transaction
      .write(({ order: orders, course: courses, enrolment: enrolments }) => [
        orders
          .patch({ orderId: order.orderId })
          .set({
            status: 'paid',
            paidAt: now,
            ...(paymentIntentId ? { paymentIntentId } : {}),
          })
          .where((attr, op) => op.eq(attr.status, 'pending'))
          .commit(),
        courses
          .check({ courseId })
          .where((attr, op) => op.eq(attr.status, 'published'))
          .commit(),
        enrolment
          ? enrolments
              .patch({ courseId, userId })
              .set({
                status: enrolment.completedAt ? 'completed' : 'active',
                orderId: order.orderId,
              })
              .where((attr, op) => op.eq(attr.status, 'dropped'))
              .commit()
          : enrolments
              .create({ courseId, userId, orderId: order.orderId })
              .commit(),
      ])
      .go();
    if (!canceled) return { result: 'fulfilled' };
  }
  throw new Error('Could not settle the order; try again');
};

/** `pending` to `expired`; a no-op for any other status. */
export const expireOrder = async (
  coreTable: CoreTable,
  order: Pick<OrderRecord, 'orderId'>,
): Promise<void> => {
  await moveFromPending(coreTable, order.orderId, { status: 'expired' });
};

/**
 * `pending` to `refunded` for an order whose payment can't be delivered; the
 * caller has refunded in Stripe. Keeps `paidAt`, setting it from `now` if the
 * order never got one.
 */
export const refundUndeliverable = async (
  coreTable: CoreTable,
  order: Pick<OrderRecord, 'orderId'>,
  reason: Exclude<OrderRefundReason, 'requested'>,
  now: string,
): Promise<void> => {
  const current = await get(coreTable, order.orderId);
  if (!current) throw new NotFoundError();
  await moveFromPending(coreTable, order.orderId, {
    status: 'refunded',
    refundReason: reason,
    refundedAt: now,
    refundedAmount: current.amount,
    paidAt: current.paidAt ?? now,
  });
};

const moveFromPending = async (
  coreTable: CoreTable,
  orderId: string,
  values: Parameters<
    ReturnType<CoreTable['entities']['order']['patch']>['set']
  >[0],
) => {
  try {
    await coreTable.entities.order
      .patch({ orderId })
      .set(values)
      .where((attr, op) => op.eq(attr.status, 'pending'))
      .go();
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
};

/**
 * Applies a refund Stripe reports. At or above the order's amount, one
 * transaction moves the order `paid` to `refunded` (reason `requested`) and
 * ends the enrolment, only if it is still this order's. Below it, only
 * `refundedAmount` rises, never falls. Repeats and old notices are no-ops.
 */
export const refundOrder = async ({
  coreTable,
  order: named,
  refundedTotal,
  now,
}: {
  coreTable: CoreTable;
  order: Pick<OrderRecord, 'orderId'>;
  refundedTotal: number;
  now: string;
}): Promise<void> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const order = await get(coreTable, named.orderId);
    if (!order) throw new NotFoundError();
    if (order.status !== 'paid') return;

    if (refundedTotal >= order.amount) {
      const { canceled } = await coreTable.transaction
        .write(({ order: orders, enrolment }) => [
          orders
            .patch({ orderId: order.orderId })
            .set({
              status: 'refunded',
              refundReason: 'requested',
              refundedAt: now,
              refundedAmount: Math.max(order.refundedAmount ?? 0, order.amount),
            })
            .where((attr, op) => op.eq(attr.status, 'paid'))
            .commit(),
          // A refund notice delayed past a re-purchase must not end the new
          // enrolment, so it only ends one that still names this order.
          enrolment
            .patch({ courseId: order.courseId, userId: order.userId })
            .set({ status: 'dropped' })
            .where((attr, op) => op.eq(attr.orderId, order.orderId))
            .commit(),
        ])
        .go();
      if (!canceled) return;
      continue;
    }

    if (refundedTotal <= (order.refundedAmount ?? 0)) return;
    try {
      await coreTable.entities.order
        .patch({ orderId: order.orderId })
        .set({ refundedAmount: refundedTotal })
        .where(
          (attr, op) =>
            `${op.eq(attr.status, 'paid')} AND ${order.refundedAmount === undefined ? op.notExists(attr.refundedAmount) : op.eq(attr.refundedAmount, order.refundedAmount)}`,
        )
        .go();
      return;
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }
  throw new Error('Could not record the refund; try again');
};

export type RestoreResult = 'restored' | 'course-unavailable' | 'not-dropped';

/**
 * Gives a refunded student their enrolment back in a course that is free
 * again: one transaction that checks the course is published and free and
 * moves the `dropped` enrolment to `completed` (if it has `completedAt`) or
 * `active`, removing `orderId`. Writes no order.
 */
export const restoreFreeEnrolment = async ({
  coreTable,
  courseId,
  userId,
}: {
  coreTable: CoreTable;
  courseId: string;
  userId: string;
}): Promise<RestoreResult> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const [{ data: course }, { data: enrolment }] = await Promise.all([
      coreTable.entities.course.get({ courseId }).go(),
      coreTable.entities.enrolment.get({ courseId, userId }).go(),
    ]);
    if (!course || course.status !== 'published' || course.priceAmount !== 0) {
      return 'course-unavailable';
    }
    if (!enrolment || enrolment.status !== 'dropped') return 'not-dropped';

    const { canceled } = await coreTable.transaction
      .write(({ course: courses, enrolment: enrolments }) => [
        courses
          .check({ courseId })
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'published')} AND ${op.eq(attr.priceAmount, 0)}`,
          )
          .commit(),
        enrolments
          .patch({ courseId, userId })
          .set({ status: enrolment.completedAt ? 'completed' : 'active' })
          .remove(['orderId'])
          .where((attr, op) => op.eq(attr.status, 'dropped'))
          .commit(),
      ])
      .go();
    if (!canceled) return 'restored';
  }
  throw new Error('Could not restore the enrolment; try again');
};

export type RefundEligibility =
  | { eligible: true; refundableUntil: string }
  | {
      eligible: false;
      reason:
        | 'not-paid'
        | 'not-current-order'
        | 'window-ended'
        | 'completed'
        | 'already-requested'
        | 'other-account';
    };

/**
 * Whether the student may ask for this order to be refunded now. Pure: the
 * first reason that applies wins. `connection` is the active connection's
 * account, absent when payments aren't connected (which is `other-account`:
 * the order can't be refunded through the account in use).
 */
export const refundEligibility = ({
  order,
  enrolment,
  connection,
  now,
}: {
  order: Pick<
    OrderRecord,
    'orderId' | 'status' | 'accountId' | 'paidAt' | 'refundRequestedAt'
  >;
  enrolment: { orderId?: string; status: string };
  connection: Pick<OrderConnection, 'status' | 'accountId'> | undefined;
  now: string;
}): RefundEligibility => {
  if (order.status !== 'paid' || !order.paidAt) {
    return { eligible: false, reason: 'not-paid' };
  }
  if (enrolment.orderId !== order.orderId || enrolment.status === 'dropped') {
    return { eligible: false, reason: 'not-current-order' };
  }
  if (
    connection?.status !== 'active' ||
    connection.accountId !== order.accountId
  ) {
    return { eligible: false, reason: 'other-account' };
  }
  if (order.refundRequestedAt !== undefined) {
    return { eligible: false, reason: 'already-requested' };
  }
  if (enrolment.status === 'completed') {
    return { eligible: false, reason: 'completed' };
  }
  const refundableUntil = refundDeadline(order.paidAt);
  if (now > refundableUntil) return { eligible: false, reason: 'window-ended' };
  return { eligible: true, refundableUntil };
};

/**
 * Records that the student's refund request was accepted and Stripe was
 * asked. Conditioned on `status = paid` and the attribute being absent; a
 * failed condition is not an error (the refund notice got there first, or
 * another request did). Never changes `status`.
 */
export const markRefundRequested = async ({
  coreTable,
  order,
  now,
}: {
  coreTable: CoreTable;
  order: Pick<OrderRecord, 'orderId'>;
  now: string;
}): Promise<void> => {
  try {
    await coreTable.entities.order
      .patch({ orderId: order.orderId })
      .set({ refundRequestedAt: now })
      .where(
        (attr, op) =>
          `${op.eq(attr.status, 'paid')} AND ${op.notExists(attr.refundRequestedAt)}`,
      )
      .go();
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }
};
