/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { v7 as uuidv7 } from 'uuid';
import type { CouponType } from '../entities/coupon.js';
import type { OrderRefundReason, OrderStatus } from '../entities/order.js';
import type { PaymentMode } from '../entities/payment-connection.js';
import type { createCoreTableService } from '../service.js';
import {
  confirmCouponWrites,
  releaseCouponWrites,
} from './coupon-redemption.js';
import { InvalidRequestError, NotFoundError } from './errors.js';
import { computeProgress, loadCurriculum } from './progress.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type TransactionEntities = Parameters<TransactionWrites>[0];
type TransactionItems = ReturnType<TransactionWrites>;

// The only writer of `order`, and of `enrolment.orderId` and the paid-restore,
// free-restore, refund-end and refund-reversal enrolment writes. Every move is a conditional
// write on the status it comes from, so a repeated or racing call changes
// nothing. None of it calls Stripe: the caller does that before or after.

/** How long a checkout lives, and how long before its end it stops being reused. */
export const CHECKOUT_TTL_SECONDS = 60 * 60;
export const CHECKOUT_REUSE_MARGIN_SECONDS = 5 * 60;

/** How long after paying a student may ask for a refund. */
export const REFUND_WINDOW_DAYS = 14;

/** A student's own refund is refused once this share of the course is done. */
export const REFUND_PROGRESS_LIMIT_PERCENT = 50;

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
  discountAmount?: number;
  couponCode?: string;
  couponType?: CouponType;
  couponValue?: number;
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
  refundFailedAt?: string;
}

/** The coupon snapshot an order carries: all four fields, or none. */
export interface OrderDiscount {
  discountAmount: number;
  couponCode: string;
  couponType: CouponType;
  couponValue: number;
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

/** A start with extra writes was cancelled; the caller reads again to see why. */
export class CheckoutStartCancelledError extends Error {
  constructor() {
    super('checkout-start-cancelled');
    this.name = 'checkout-start-cancelled';
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
 *
 * With a `discount` the order is charged `listAmount - discountAmount` and
 * carries the coupon snapshot. With `extraWrites` (the coupon claim, or the
 * release of an earlier unpaid order) they join the same transaction, which
 * then also checks the course is published and the student not enrolled.
 */
export const startOrder = async ({
  coreTable,
  course,
  userId,
  now,
  getConnection,
  ttlSeconds = CHECKOUT_TTL_SECONDS,
  discount,
  extraWrites,
}: {
  coreTable: CoreTable;
  course: OrderCourse;
  userId: string;
  now: string;
  /** Reads the connection record (payment-connection.ts' getConnection). */
  getConnection: () => Promise<OrderConnection | undefined>;
  /** Local development shortens a checkout's life; nothing else does. */
  ttlSeconds?: number;
  discount?: OrderDiscount;
  extraWrites?: (
    entities: TransactionEntities,
    order: OrderRecord,
  ) => TransactionItems;
}): Promise<OrderRecord> => {
  if (course.priceAmount === 0) {
    throw new InvalidRequestError('This course is free');
  }
  if (course.status !== 'published') throw new NotFoundError();
  const amount = course.priceAmount - (discount?.discountAmount ?? 0);
  if (
    discount &&
    !(discount.discountAmount > 0 && amount > 0 && amount < course.priceAmount)
  ) {
    throw new InvalidRequestError('The discount leaves nothing to charge');
  }

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
      amount,
      currency: course.priceCurrency,
      ...discount,
      status: 'pending',
      expiresAt,
    };
    // `revision` is left alone: it orders the administrator's own writes, and
    // every checkout bumping it would make each key rotation lose.
    const { canceled } = await coreTable.transaction
      .write((entities) => [
        ...startWrites(entities, order, read, expiresAt),
        ...(extraWrites
          ? [
              entities.course
                .check({ courseId: course.courseId })
                .where((attr, op) => op.eq(attr.status, 'published'))
                .commit(),
              entities.enrolment
                .check({ courseId: course.courseId, userId })
                .where(
                  (attr, op) =>
                    `${op.notExists(attr.status)} OR ${op.eq(attr.status, 'dropped')}`,
                )
                .commit(),
              ...extraWrites(entities, order),
            ]
          : []),
      ])
      .go();
    if (!canceled) return order;
    // The extra writes carry conditions of their own (the coupon's limit, the
    // earlier order's status), so the caller reads again to say which failed.
    if (extraWrites) throw new CheckoutStartCancelledError();
  }
  throw new Error('Could not start the checkout; try again');
};

/**
 * Enrols a student with a code that takes the whole price: one transaction
 * that creates the order already `paid` (amount 0, no Stripe session, ending
 * now), raises the connection's `latestCheckoutExpiresAt`, checks the course
 * is published, and creates the enrolment or restores a `dropped` one, with
 * the caller's `extraWrites` (the redemption claim, an earlier unpaid order's
 * end). Throws `payments-unavailable` when the connection isn't active and a
 * cancelled start when any condition failed, for the caller to read again.
 */
export const startFreeOrder = async ({
  coreTable,
  course,
  userId,
  now,
  getConnection,
  discount,
  extraWrites,
}: {
  coreTable: CoreTable;
  course: OrderCourse;
  userId: string;
  now: string;
  getConnection: () => Promise<OrderConnection | undefined>;
  discount: OrderDiscount;
  extraWrites: (
    entities: TransactionEntities,
    order: OrderRecord,
  ) => TransactionItems;
}): Promise<OrderRecord> => {
  if (course.status !== 'published') throw new NotFoundError();
  if (discount.discountAmount !== course.priceAmount) {
    throw new InvalidRequestError('The discount leaves something to charge');
  }
  const connection = await getConnection();
  if (
    !connection ||
    connection.status !== 'active' ||
    !connection.accountId ||
    !connection.mode
  ) {
    throw new PaymentsUnavailableError();
  }
  const { courseId } = course;
  const { data: enrolment } = await coreTable.entities.enrolment
    .get({ courseId, userId })
    .go();
  if (enrolment && enrolment.status !== 'dropped') {
    throw new CheckoutStartCancelledError();
  }
  const order: OrderRecord = {
    orderId: uuidv7(),
    userId,
    courseId,
    accountId: connection.accountId,
    mode: connection.mode,
    courseTitle: course.title,
    listAmount: course.priceAmount,
    amount: 0,
    currency: course.priceCurrency,
    ...discount,
    status: 'paid',
    expiresAt: now,
    paidAt: now,
  };
  const { canceled } = await coreTable.transaction
    .write((entities) => [
      ...startWrites(entities, order, connection.latestCheckoutExpiresAt, now),
      entities.course
        .check({ courseId })
        .where((attr, op) => op.eq(attr.status, 'published'))
        .commit(),
      enrolmentGrantWrite(entities.enrolment, order, enrolment),
      ...extraWrites(entities, order),
    ])
    .go();
  if (canceled) throw new CheckoutStartCancelledError();
  return order;
};

const startWrites = (
  { order: orders, paymentConnection }: TransactionEntities,
  order: OrderRecord,
  read: string | undefined,
  expiresAt: string,
) => [
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
];

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
      .write((entities) => [
        ...settleWrites(entities, order, enrolment, now, paymentIntentId),
        ...(order.couponCode
          ? confirmCouponWrites(entities, {
              courseId,
              code: order.couponCode,
              userId,
            })
          : []),
      ])
      .go();
    if (!canceled) return { result: 'fulfilled' };
  }
  throw new Error('Could not settle the order; try again');
};

// The enrolment a paid order gives: created, or restored from `dropped`.
const enrolmentGrantWrite = (
  enrolments: TransactionEntities['enrolment'],
  {
    courseId,
    userId,
    orderId,
  }: Pick<OrderRecord, 'courseId' | 'userId' | 'orderId'>,
  enrolment: { completedAt?: string } | null,
) =>
  enrolment
    ? enrolments
        .patch({ courseId, userId })
        .set({
          status: enrolment.completedAt ? 'completed' : 'active',
          orderId,
        })
        .where((attr, op) => op.eq(attr.status, 'dropped'))
        .commit()
    : enrolments.create({ courseId, userId, orderId }).commit();

const settleWrites = (
  {
    order: orders,
    course: courses,
    enrolment: enrolments,
  }: TransactionEntities,
  order: OrderRecord,
  enrolment: { completedAt?: string } | null,
  now: string,
  paymentIntentId: string | undefined,
) => {
  const { courseId } = order;
  return [
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
    enrolmentGrantWrite(enrolments, order, enrolment),
  ];
};

/**
 * The writes that move a `pending` order to `expired`, and release its
 * coupon redemption when it has one. Both are conditional, so a replayed or
 * racing call cancels the transaction and changes nothing.
 */
export const expireOrderWrites = (
  entities: TransactionEntities,
  order: Pick<OrderRecord, 'orderId' | 'courseId' | 'userId' | 'couponCode'>,
): TransactionItems => [
  entities.order
    .patch({ orderId: order.orderId })
    .set({ status: 'expired' })
    .where((attr, op) => op.eq(attr.status, 'pending'))
    .commit(),
  ...(order.couponCode
    ? releaseCouponWrites(entities, {
        courseId: order.courseId,
        code: order.couponCode,
        userId: order.userId,
      })
    : []),
];

/** `pending` to `expired`, releasing the coupon; a no-op for any other status. */
export const expireOrder = async (
  coreTable: CoreTable,
  order: Pick<OrderRecord, 'orderId'>,
): Promise<void> => {
  const current = await get(coreTable, order.orderId);
  if (!current || current.status !== 'pending') return;
  // A cancelled transaction means another writer moved the order first.
  await coreTable.transaction
    .write((entities) => expireOrderWrites(entities, current))
    .go();
};

/**
 * `pending` to `refunded` for an order whose payment can't be delivered; the
 * caller has refunded in Stripe. Keeps `paidAt`, setting it from `now` if the
 * order never got one. Releases the order's coupon redemption, since the
 * student got the money back and no enrolment.
 */
export const refundUndeliverable = async (
  coreTable: CoreTable,
  order: Pick<OrderRecord, 'orderId'>,
  reason: Exclude<OrderRefundReason, 'requested'>,
  now: string,
): Promise<void> => {
  const current = await get(coreTable, order.orderId);
  if (!current) throw new NotFoundError();
  await coreTable.transaction
    .write((entities) => [
      entities.order
        .patch({ orderId: order.orderId })
        .set({
          status: 'refunded',
          refundReason: reason,
          refundedAt: now,
          refundedAmount: current.amount,
          paidAt: current.paidAt ?? now,
        })
        .where((attr, op) => op.eq(attr.status, 'pending'))
        .commit(),
      ...(current.couponCode
        ? releaseCouponWrites(entities, {
            courseId: current.courseId,
            code: current.couponCode,
            userId: current.userId,
          })
        : []),
    ])
    .go();
};

/**
 * Applies a refund Stripe reports. At or above the order's amount, one
 * transaction moves the order `paid` to `refunded` (reason `requested`) and
 * ends the enrolment, only if it is still this order's. Below it, only
 * `refundedAmount` rises, never falls. Repeats and old notices are no-ops,
 * including a notice created before the order's `refundFailedAt`.
 */
export const refundOrder = async ({
  coreTable,
  order: named,
  refundedTotal,
  now,
  eventAt,
}: {
  coreTable: CoreTable;
  order: Pick<OrderRecord, 'orderId'>;
  refundedTotal: number;
  now: string;
  /** When Stripe created the notice, if known. */
  eventAt?: string;
}): Promise<void> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const order = await get(coreTable, named.orderId);
    if (!order) throw new NotFoundError();
    if (order.status !== 'paid') return;
    // A notice created before the refund failed is an old one, delivered again
    // or late: the refund it reports was taken back.
    if (
      eventAt !== undefined &&
      order.refundFailedAt !== undefined &&
      eventAt <= order.refundFailedAt
    ) {
      return;
    }

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

/**
 * Undoes a refund Stripe reports as failed after `charge.refunded` ended
 * access. One transaction moves a `refunded` order that was refunded on
 * request back to `paid`, removing `refundedAt` and `refundedAmount` and
 * setting `refundFailedAt` (`refundRequestedAt` stays), and restores the
 * enrolment `dropped` to `completed` (if it has `completedAt`) or `active`.
 * An order the student bought again after the refund (the enrolment names
 * another order) is not moved back, so the student keeps one paid order for
 * the course and the enrolment is untouched; the order stays `refunded` and
 * only gets `refundFailedAt`, so support can find the student who paid twice
 * and was never refunded. Both writes are conditioned on the order being
 * `refunded` (the second also on `refundFailedAt` being absent), so a repeated
 * or retried failure changes nothing. Returns `reversed` for the move,
 * `repurchased` for the mark, and `false` when nothing was written.
 */
export const reverseRefund = async ({
  coreTable,
  order: named,
  now,
}: {
  coreTable: CoreTable;
  order: Pick<OrderRecord, 'orderId'>;
  now: string;
}): Promise<false | 'reversed' | 'repurchased'> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const order = await get(coreTable, named.orderId);
    if (!order) throw new NotFoundError();
    if (order.status !== 'refunded' || order.refundReason !== 'requested') {
      return false;
    }
    const { data: enrolment } = await coreTable.entities.enrolment
      .get({ courseId: order.courseId, userId: order.userId })
      .go();
    // Bought again after the refund: the enrolment names the new order, and
    // this one back at `paid` would be a second paid order for the course.
    if (enrolment?.orderId && enrolment.orderId !== order.orderId) {
      try {
        await coreTable.entities.order
          .patch({ orderId: order.orderId })
          .set({ refundFailedAt: now })
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'refunded')} AND ${op.eq(attr.refundReason, 'requested')} AND ${op.notExists(attr.refundFailedAt)}`,
          )
          .go();
        return 'repurchased';
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        return false;
      }
    }
    const restore =
      enrolment?.orderId === order.orderId && enrolment.status === 'dropped';
    const { canceled } = await coreTable.transaction
      .write(({ order: orders, enrolment: enrolments }) => [
        orders
          .patch({ orderId: order.orderId })
          .set({ status: 'paid', refundFailedAt: now })
          .remove(['refundedAt', 'refundedAmount'])
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'refunded')} AND ${op.eq(attr.refundReason, 'requested')}`,
          )
          .commit(),
        // A re-purchase, or an enrolment that is not `dropped`, is left alone.
        ...(restore
          ? [
              enrolments
                .patch({ courseId: order.courseId, userId: order.userId })
                .set({
                  status: enrolment?.completedAt ? 'completed' : 'active',
                })
                .where(
                  (attr, op) =>
                    `${op.eq(attr.orderId, order.orderId)} AND ${op.eq(attr.status, 'dropped')}`,
                )
                .commit(),
            ]
          : []),
      ])
      .go();
    if (!canceled) return 'reversed';
  }
  throw new Error('Could not reverse the refund; try again');
};

/**
 * The orders a student paid for, was refunded on request, and whose refund
 * then failed after they bought the course again: `refunded` with
 * `refundFailedAt`. The student is out of pocket until support refunds them,
 * so an admin sees these. Oldest failure first.
 */
export const listFailedRefunds = async (
  coreTable: CoreTable,
): Promise<OrderRecord[]> => {
  const { data } = await coreTable.entities.order.scan
    .where(
      (attr, op) =>
        `${op.eq(attr.status, 'refunded')} AND ${op.exists(attr.refundFailedAt)}`,
    )
    .go({ pages: 'all' });
  return (data as OrderRecord[]).sort((a, b) =>
    (a.refundFailedAt ?? '').localeCompare(b.refundFailedAt ?? ''),
  );
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

/** The enrolment was bought, so only a refund ends it. */
export class EnrolmentPaidForError extends Error {
  constructor(message = 'enrolment-paid-for') {
    super(message);
    this.name = 'enrolment-paid-for';
  }
}

/**
 * A student leaves a course they did not pay for: one conditional write moves
 * their `active` or `completed` enrolment to `dropped`, only while it has no
 * `orderId`, keeping `completedAt`, `progressPercent` and completions. Returns
 * whether it made the move (false for a missing or already `dropped`
 * enrolment). Throws `EnrolmentPaidForError` for an enrolment with an
 * `orderId`, which is never changed.
 */
export const unenrolFromCourse = async ({
  coreTable,
  userId,
  courseId,
  now,
}: {
  coreTable: CoreTable;
  userId: string;
  courseId: string;
  now: string;
}): Promise<boolean> => {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { data: enrolment } = await coreTable.entities.enrolment
      .get({ courseId, userId })
      .go();
    if (!enrolment || enrolment.status === 'dropped') return false;
    if (enrolment.orderId) throw new EnrolmentPaidForError();
    try {
      await coreTable.entities.enrolment
        .patch({ courseId, userId })
        .set({ status: 'dropped', updatedAt: now })
        .where(
          (attr, op) =>
            `${op.ne(attr.status, 'dropped')} AND ${op.notExists(attr.orderId)}`,
        )
        .go();
      return true;
    } catch (error) {
      // Changed since it was read: read it again to see how.
      if (!isConditionalFailure(error)) throw error;
    }
  }
  throw new Error('Could not end the enrolment; try again');
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
        | 'progress-limit'
        | 'refunded-before'
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
  progressPercent,
  refundedBefore,
  now,
}: {
  order: Pick<
    OrderRecord,
    | 'orderId'
    | 'status'
    | 'accountId'
    | 'amount'
    | 'paidAt'
    | 'refundRequestedAt'
  >;
  enrolment: { orderId?: string; status: string };
  connection: Pick<OrderConnection, 'status' | 'accountId'> | undefined;
  /** The student's share of the course as it is now (`computeProgress`). */
  progressPercent: number;
  /** An earlier order of theirs for this course was refunded at their request. */
  refundedBefore: boolean;
  now: string;
}): RefundEligibility => {
  // An order of nothing (a code took the whole price) has no payment to return.
  if (order.status !== 'paid' || !order.paidAt || order.amount <= 0) {
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
  if (progressPercent >= REFUND_PROGRESS_LIMIT_PERCENT) {
    return { eligible: false, reason: 'progress-limit' };
  }
  if (refundedBefore) return { eligible: false, reason: 'refunded-before' };
  const refundableUntil = refundDeadline(order.paidAt);
  if (now > refundableUntil) return { eligible: false, reason: 'window-ended' };
  return { eligible: true, refundableUntil };
};

/**
 * Whether an earlier order of the student's for the course was refunded at
 * their own request. An operator's refund (no `refundRequestedAt`) and an
 * automatic one (`duplicate`, `unavailable`, `mismatch`) don't count.
 */
export const readRefundedBefore = async ({
  coreTable,
  userId,
  courseId,
}: {
  coreTable: CoreTable;
  userId: string;
  courseId: string;
}): Promise<boolean> => {
  const { data: orders } = await coreTable.entities.order.query
    .byStudentCourse({ userId, courseId })
    .go({ pages: 'all' });
  return orders.some(
    (o) =>
      o.status === 'refunded' &&
      o.refundReason === 'requested' &&
      o.refundRequestedAt !== undefined,
  );
};

export interface RefundLimits {
  progressPercent: number;
  refundedBefore: boolean;
}

/**
 * What `refundEligibility` needs besides the order: the student's progress
 * computed now from their completions and the current curriculum (not the
 * stored `progressPercent`, which lags a completion), and `readRefundedBefore`.
 */
export const readRefundLimits = async ({
  coreTable,
  userId,
  courseId,
}: {
  coreTable: CoreTable;
  userId: string;
  courseId: string;
}): Promise<RefundLimits> => {
  const [curriculum, { data: completions }, refundedBefore] = await Promise.all(
    [
      loadCurriculum(coreTable, courseId),
      coreTable.entities.itemCompletion.query
        .primary({ userId, courseId })
        .go({ pages: 'all' }),
      readRefundedBefore({ coreTable, userId, courseId }),
    ],
  );
  const { progressPercent } = computeProgress(
    curriculum,
    new Set(completions.map(({ contentItemId }) => contentItemId)),
  );
  return { progressPercent, refundedBefore };
};

/**
 * Records that Stripe reported the student's requested refund as failed.
 * Conditioned on `status = paid` and a refund having been requested; a failed
 * condition is not an error (the order was refunded meanwhile, or no request
 * of the student's is behind this notice). Keeps the first failure's time and
 * never changes `status`. Returns whether it wrote anything.
 */
export const markRefundFailed = async ({
  coreTable,
  order,
  now,
}: {
  coreTable: CoreTable;
  order: Pick<OrderRecord, 'orderId'>;
  now: string;
}): Promise<boolean> => {
  try {
    await coreTable.entities.order
      .patch({ orderId: order.orderId })
      .set({ refundFailedAt: now })
      .where(
        (attr, op) =>
          `${op.eq(attr.status, 'paid')} AND ${op.exists(attr.refundRequestedAt)} AND ${op.notExists(attr.refundFailedAt)}`,
      )
      .go();
    return true;
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    return false;
  }
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
