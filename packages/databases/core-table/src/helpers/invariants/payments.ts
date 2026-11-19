/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  isSupportedCurrency,
  PRICE_MAX,
  PRICE_MIN,
} from '@discava/common-web-utils/price';
import { ORDER_REFUND_REASONS } from '../../entities/order.js';
import { PAYMENT_CHANGE_KINDS } from '../../entities/payment-change.js';
import { PAYMENT_CONNECTION_STATUSES } from '../../entities/payment-connection.js';
import { type Check, groupBy, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// Payments (the Stripe checkout feature). Price and order shape, and the links
// between orders and enrolments that make "paid exactly once" and "unpaid
// users cannot access paid content" checkable as data.

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

// A course's price is whole minor units, free or within the bounds, in a
// supported currency, and `pricedAt` is set exactly when it isn't free.
export const checkPriceShape = (snapshot: TableSnapshot): Violation[] =>
  snapshot.courses.flatMap(
    ({ courseId, priceAmount, priceCurrency, pricedAt }) => {
      const problems: string[] = [];
      if (
        !isInteger(priceAmount) ||
        (priceAmount !== 0 &&
          (priceAmount < PRICE_MIN || priceAmount > PRICE_MAX))
      ) {
        problems.push(
          `priceAmount ${priceAmount} is not 0 or a whole number from ${PRICE_MIN} to ${PRICE_MAX}`,
        );
      }
      if (!isSupportedCurrency(String(priceCurrency))) {
        problems.push(`priceCurrency ${priceCurrency} is not supported`);
      }
      if (priceAmount > 0 !== (pricedAt !== undefined)) {
        problems.push(
          priceAmount > 0
            ? 'priced, but pricedAt is not set'
            : 'free, but pricedAt is set',
        );
      }
      return problems.map((message) =>
        violation('price-shape', { courseId }, message),
      );
    },
  );

// An order has what its status needs. A pending order past its expiry is not a
// violation (its expired event may be late), and a course set back to free
// with paid orders is not one either.
export const checkOrderShape = (snapshot: TableSnapshot): Violation[] => {
  const sessions = groupBy(
    snapshot.orders.filter((o) => o.checkoutSessionId !== undefined),
    (o) => o.checkoutSessionId,
  );
  return snapshot.orders.flatMap((order) => {
    const problems: string[] = [];
    for (const field of [
      'userId',
      'courseId',
      'accountId',
      'currency',
      'status',
      'expiresAt',
    ] as const) {
      if (!order[field]) problems.push(`${field} is not set`);
    }
    if (
      !isInteger(order.listAmount) ||
      order.listAmount < PRICE_MIN ||
      order.listAmount > PRICE_MAX
    ) {
      problems.push(`listAmount ${order.listAmount} is out of range`);
    }
    if (
      !isInteger(order.amount) ||
      order.amount < 0 ||
      order.amount > order.listAmount
    ) {
      problems.push(`amount ${order.amount} is not from 0 to listAmount`);
    }
    if (!isSupportedCurrency(String(order.currency))) {
      problems.push(`currency ${order.currency} is not supported`);
    }
    if (order.status === 'paid') {
      if (!order.paidAt) problems.push('paid, but paidAt is not set');
      if (order.amount > 0 && !order.paymentIntentId) {
        problems.push('paid, but there is no payment intent');
      }
    }
    if (order.status === 'refunded') {
      if (!order.refundedAt)
        problems.push('refunded, but refundedAt is not set');
      if (
        !order.refundReason ||
        !(ORDER_REFUND_REASONS as readonly string[]).includes(
          order.refundReason,
        )
      ) {
        problems.push(`refund reason ${order.refundReason} is not known`);
      }
      if (order.refundReason === 'requested' && !order.paidAt) {
        problems.push('refunded on request, but paidAt is not set');
      }
    }
    if (
      order.refundedAmount !== undefined &&
      order.refundedAmount > order.amount
    ) {
      problems.push('refundedAmount is more than the amount');
    }
    if (
      (order.status === 'pending' || order.status === 'expired') &&
      order.paidAt !== undefined
    ) {
      problems.push(`${order.status}, but paidAt is set`);
    }
    if (
      order.checkoutSessionId !== undefined &&
      (sessions.get(order.checkoutSessionId)?.length ?? 0) > 1
    ) {
      problems.push('its checkout session is on another order too');
    }
    return problems.map((message) =>
      violation('order-shape', { orderId: order.orderId }, message),
    );
  });
};

// Every paid order has its student's enrolment, not dropped, pointing back at
// it, and a student has at most one paid order per course: exactly once, as
// data.
export const checkPaidOrderHasEnrolment = (
  snapshot: TableSnapshot,
): Violation[] => {
  const enrolments = new Map(
    snapshot.enrolments.map((e) => [`${e.userId} ${e.courseId}`, e]),
  );
  const paid = snapshot.orders.filter((o) => o.status === 'paid');
  const perStudentCourse = groupBy(paid, (o) => `${o.userId} ${o.courseId}`);
  return paid.flatMap((order) => {
    const problems: string[] = [];
    const enrolment = enrolments.get(`${order.userId} ${order.courseId}`);
    if (!enrolment) {
      problems.push('paid, but the student has no enrolment');
    } else if (enrolment.status === 'dropped') {
      problems.push('paid, but the enrolment is dropped');
    } else if (enrolment.orderId !== order.orderId) {
      problems.push('paid, but the enrolment names another order');
    }
    if (
      (perStudentCourse.get(`${order.userId} ${order.courseId}`)?.length ?? 0) >
      1
    ) {
      problems.push('the student has another paid order for the course');
    }
    return problems.map((message) =>
      violation(
        'paid-order-has-enrolment',
        { orderId: order.orderId },
        message,
      ),
    );
  });
};

// An enrolment's `orderId` names an order for the same student and course
// that is paid, or was refunded on request with the enrolment ended. An order
// refunded because it couldn't be delivered is never an enrolment's order.
export const checkEnrolmentOrderMatches = (
  snapshot: TableSnapshot,
): Violation[] => {
  const orders = new Map(snapshot.orders.map((o) => [o.orderId, o]));
  return snapshot.enrolments.flatMap((enrolment) => {
    if (enrolment.orderId === undefined) return [];
    const order = orders.get(enrolment.orderId);
    const record = { userId: enrolment.userId, courseId: enrolment.courseId };
    let problem: string | undefined;
    if (!order) {
      problem = 'its order does not exist';
    } else if (
      order.userId !== enrolment.userId ||
      order.courseId !== enrolment.courseId
    ) {
      problem = 'its order is for another student or course';
    } else if (order.status === 'paid') {
      problem = undefined;
    } else if (
      order.status === 'refunded' &&
      order.refundReason === 'requested' &&
      enrolment.status === 'dropped'
    ) {
      problem = undefined;
    } else {
      problem = `its order is ${order.status}${order.refundReason ? ` (${order.refundReason})` : ''} while the enrolment is ${enrolment.status}`;
    }
    return problem
      ? [violation('enrolment-order-matches', record, problem)]
      : [];
  });
};

// In a priced course, an enrolment with no order was made before the course
// was priced (within ten seconds, for the write that priced it), or restored
// for free after a refund when the course was free again. Anything else is
// someone in a paid course without paying.
const PRICED_GRACE_MS = 10_000;
export const checkPaidCourseEnrolmentPaid = (
  snapshot: TableSnapshot,
): Violation[] => {
  const priced = new Map(
    snapshot.courses
      .filter((c) => c.priceAmount > 0)
      .map((c) => [c.courseId, c]),
  );
  const refunded = new Set(
    snapshot.orders
      .filter((o) => o.status === 'refunded')
      .map((o) => `${o.userId} ${o.courseId}`),
  );
  return snapshot.enrolments.flatMap((enrolment) => {
    const course = priced.get(enrolment.courseId);
    if (!course || enrolment.orderId !== undefined) return [];
    if (
      enrolment.status !== 'dropped' &&
      refunded.has(`${enrolment.userId} ${enrolment.courseId}`)
    ) {
      return [];
    }
    const pricedAt = course.pricedAt ? Date.parse(course.pricedAt) : undefined;
    if (
      pricedAt !== undefined &&
      Date.parse(enrolment.createdAt) <= pricedAt + PRICED_GRACE_MS
    ) {
      return [];
    }
    return [
      violation(
        'paid-course-enrolment-paid',
        { userId: enrolment.userId, courseId: enrolment.courseId },
        'enrolled in a priced course with no order, after it was priced',
      ),
    ];
  });
};

// The administrator's Stripe setup: a valid status, the facts that status
// needs, a positive revision, and one record at most.
export const checkPaymentConnectionShape = (
  snapshot: TableSnapshot,
): Violation[] => {
  const record = { record: 'paymentConnection' };
  const problems: string[] = [];
  if (snapshot.paymentConnections.length > 1) {
    problems.push(`${snapshot.paymentConnections.length} connection records`);
  }
  for (const c of snapshot.paymentConnections) {
    if (
      !(PAYMENT_CONNECTION_STATUSES as readonly string[]).includes(c.status)
    ) {
      problems.push(`status ${c.status} is not known`);
    }
    if (!isInteger(c.revision) || c.revision < 1) {
      problems.push(`revision ${c.revision} is not a positive integer`);
    }
    // A change from a disconnected record has no account yet.
    const needsAccount =
      c.status === 'active' ||
      (c.status === 'changing' && c.previousStatus === 'active');
    if (c.status === 'active' || c.status === 'changing') {
      if (!c.mode) problems.push(`${c.status}, but mode is not set`);
    }
    if (needsAccount) {
      for (const field of ['accountId', 'accountName'] as const) {
        if (!c[field]) problems.push(`${c.status}, but ${field} is not set`);
      }
      if (c.keyLast4?.length !== 4) {
        problems.push(`${c.status}, but keyLast4 is not four characters`);
      }
    }
    if (c.status === 'active' && (!c.webhookEndpointId || !c.webhookUrl)) {
      problems.push('active, but the webhook registration is not set');
    }
    if (c.status === 'changing' && !c.leaseUntil) {
      problems.push('changing, but leaseUntil is not set');
    }
  }
  return problems.map((message) =>
    violation('payment-connection-shape', record, message),
  );
};

// Every order's expiry is covered by the connection's `latestCheckoutExpiresAt`,
// which is what makes "no checkout is open" a safe check before a switch.
export const checkCheckoutWindowCoversOrders = (
  snapshot: TableSnapshot,
): Violation[] => {
  const [connection] = snapshot.paymentConnections;
  return snapshot.orders.flatMap((order) => {
    if (!connection) {
      return [
        violation(
          'checkout-window-covers-orders',
          { orderId: order.orderId },
          'there is an order but no connection record',
        ),
      ];
    }
    if (
      !connection.latestCheckoutExpiresAt ||
      order.expiresAt > connection.latestCheckoutExpiresAt
    ) {
      return [
        violation(
          'checkout-window-covers-orders',
          { orderId: order.orderId },
          `expires ${order.expiresAt}, after the connection's latestCheckoutExpiresAt ${connection.latestCheckoutExpiresAt}`,
        ),
      ];
    }
    return [];
  });
};

// Every order names its account, and one created while the record is active
// since its last change names that record's account. Orders from earlier
// connections may name another account.
export const checkOrderAccountKnown = (
  snapshot: TableSnapshot,
): Violation[] => {
  const [connection] = snapshot.paymentConnections;
  return snapshot.orders.flatMap((order) => {
    if (!order.accountId) {
      return [
        violation(
          'order-account-known',
          { orderId: order.orderId },
          'has no accountId',
        ),
      ];
    }
    if (
      connection?.status === 'active' &&
      connection.changedAt !== undefined &&
      order.createdAt > connection.changedAt &&
      order.accountId !== connection.accountId
    ) {
      return [
        violation(
          'order-account-known',
          { orderId: order.orderId },
          `names ${order.accountId}, not the connected account ${connection.accountId}`,
        ),
      ];
    }
    return [];
  });
};

// Audit rows carry who and when, and never more than four characters of a key
// or any signing secret.
const SECRET_PATTERN = /\b(?:sk|rk|pk)_(?:test|live)_\w+|whsec_\w+/;
export const checkPaymentChangeShape = (snapshot: TableSnapshot): Violation[] =>
  snapshot.paymentChanges.flatMap((change) => {
    const problems: string[] = [];
    for (const field of ['kind', 'byUserId', 'byName', 'at'] as const) {
      if (!change[field]) problems.push(`${field} is not set`);
    }
    if (!(PAYMENT_CHANGE_KINDS as readonly string[]).includes(change.kind)) {
      problems.push(`kind ${change.kind} is not known`);
    }
    if (change.keyLast4 !== undefined && change.keyLast4.length > 4) {
      problems.push('keyLast4 holds more than four characters');
    }
    if (
      Object.values(change).some(
        (value) => typeof value === 'string' && SECRET_PATTERN.test(value),
      )
    ) {
      problems.push('holds what looks like a key or signing secret');
    }
    return problems.map((message) =>
      violation('payment-change-shape', { changeId: change.changeId }, message),
    );
  });

export const PAYMENTS_CHECKS = [
  { name: 'price-shape', check: checkPriceShape },
  { name: 'order-shape', check: checkOrderShape },
  { name: 'paid-order-has-enrolment', check: checkPaidOrderHasEnrolment },
  { name: 'enrolment-order-matches', check: checkEnrolmentOrderMatches },
  { name: 'paid-course-enrolment-paid', check: checkPaidCourseEnrolmentPaid },
  { name: 'payment-connection-shape', check: checkPaymentConnectionShape },
  {
    name: 'checkout-window-covers-orders',
    check: checkCheckoutWindowCoversOrders,
  },
  { name: 'order-account-known', check: checkOrderAccountKnown },
  { name: 'payment-change-shape', check: checkPaymentChangeShape },
] as const satisfies readonly Check[];
