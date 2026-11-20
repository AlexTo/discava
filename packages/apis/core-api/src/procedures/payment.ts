/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import { localCheckoutTtlSeconds } from '@discava/common-server-utils/local-dev';
import { withStripe } from '@discava/common-server-utils/stripe/client';
import {
  attachCheckoutSession,
  expireOrder,
  findOpenOrder,
  getConnection,
  markRefundRequested,
  PaymentsUnavailableError,
  REFUND_WINDOW_DAYS,
  refundDeadline,
  refundEligibility,
  startOrder,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  CheckoutInputSchema,
  CheckoutOutputSchema,
  MyOrderInputSchema,
  MyOrderOutputSchema,
  PaymentAvailableOutputSchema,
  RequestRefundInputSchema,
  RequestRefundOutputSchema,
} from '../schema/index.js';

// Whether a Buy now can start: the connection record only, nothing about the
// account, mode or key.
export const paymentAvailable = courseProcedure
  .output(PaymentAvailableOutputSchema)
  .query(async ({ ctx }) => ({
    available: (await getConnection(ctx.coreTable))?.status === 'active',
  }));

// Starts a checkout for a priced course and returns Stripe's hosted page. The
// amount and currency are the course's, never the input's. The order is
// written (with the connection check) before Stripe is called, and the API
// key is read only by that call, after the connection check has passed.
export const checkout = courseProcedure
  .input(CheckoutInputSchema)
  .output(CheckoutOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const { courseId } = input;
    const userId = ctx.user.sub;

    const origin = getAllowedOrigin(ctx.event);
    if (!origin) throw new TRPCError({ code: 'FORBIDDEN' });

    const { data: course } = await coreTable.entities.course
      .get({ courseId })
      .go();
    if (!course || course.status !== 'published') {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    if (course.priceAmount === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This course is free; enrol instead',
      });
    }

    const { data: enrolment } = await coreTable.entities.enrolment
      .get({ courseId, userId })
      .go();
    if (enrolment && enrolment.status !== 'dropped') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'You are already enrolled in this course',
      });
    }

    const now = new Date().toISOString();
    const open = await findOpenOrder({ coreTable, userId, courseId, now });
    if (open?.checkoutUrl) return { checkoutUrl: open.checkoutUrl };

    let order: Awaited<ReturnType<typeof startOrder>>;
    try {
      order = await startOrder({
        coreTable,
        course,
        userId,
        now,
        getConnection: () => getConnection(coreTable),
        ttlSeconds: localCheckoutTtlSeconds(),
      });
    } catch (error) {
      if (error instanceof PaymentsUnavailableError) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Payments are unavailable right now',
        });
      }
      throw error;
    }

    try {
      const session = await withStripe((stripe) =>
        stripe.checkout.sessions.create(
          {
            mode: 'payment',
            allowed_payment_method_types: ['card'],
            adaptive_pricing: { enabled: false },
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: order.currency,
                  unit_amount: order.amount,
                  product_data: { name: order.courseTitle },
                },
              },
            ],
            client_reference_id: order.orderId,
            metadata: { orderId: order.orderId, userId, courseId },
            payment_intent_data: {
              metadata: { orderId: order.orderId, userId, courseId },
            },
            expires_at: Math.floor(new Date(order.expiresAt).getTime() / 1000),
            success_url: `${origin}/learn/${courseId}?checkout=success`,
            cancel_url: `${origin}/learn/${courseId}?checkout=cancelled`,
          },
          { idempotencyKey: order.orderId },
        ),
      );
      if (!session.url) throw new Error('Stripe returned no checkout address');
      await attachCheckoutSession(coreTable, order, {
        sessionId: session.id,
        url: session.url,
      });
      return { checkoutUrl: session.url };
    } catch (error) {
      console.error('Could not create the checkout session', {
        orderId: order.orderId,
        error: error instanceof Error ? error.name : 'unknown',
      });
      await expireOrder(coreTable, order).catch(() => undefined);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: "Couldn't start the payment",
      });
    }
  });

const NO_PURCHASE = 'No purchase to refund';

// Asks Stripe to refund the student's own paid order, once, then marks the
// order. It never moves the order or the enrolment: `charge.refunded` does.
// Stripe is called before the mark, so a crash between the two leaves a real
// refund and no mark (the notice repairs it), never a mark and no refund.
export const requestRefund = courseProcedure
  .input(RequestRefundInputSchema)
  .output(RequestRefundOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const { courseId } = input;
    const userId = ctx.user.sub;

    const { data: enrolment } = await coreTable.entities.enrolment
      .get({ courseId, userId })
      .go();
    if (!enrolment?.orderId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: NO_PURCHASE });
    }
    const { data: order } = await coreTable.entities.order
      .get({ orderId: enrolment.orderId })
      .go();
    if (!order || order.userId !== userId || order.courseId !== courseId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: NO_PURCHASE });
    }

    const now = new Date().toISOString();
    const decision = refundEligibility({
      order,
      enrolment,
      connection: await getConnection(coreTable),
      now,
    });
    if (!decision.eligible) {
      switch (decision.reason) {
        case 'already-requested':
          return { refundRequestedAt: order.refundRequestedAt as string };
        case 'window-ended':
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `The ${REFUND_WINDOW_DAYS}-day refund period for this course has ended`,
          });
        case 'completed':
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: "A course can't be refunded after you have completed it",
          });
        case 'other-account':
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: "This purchase can't be refunded here right now",
          });
        default:
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: NO_PURCHASE,
          });
      }
    }

    const { paymentIntentId } = order;
    const amount = order.amount - (order.refundedAmount ?? 0);
    if (!paymentIntentId || amount <= 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: "This purchase can't be refunded here right now",
      });
    }

    try {
      await withStripe((stripe) =>
        stripe.refunds.create(
          { payment_intent: paymentIntentId, amount },
          { idempotencyKey: `refund-${order.orderId}` },
        ),
      );
    } catch (error) {
      console.error('Could not create the refund', {
        orderId: order.orderId,
        error: error instanceof Error ? error.name : 'unknown',
      });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: "Couldn't request the refund",
      });
    }

    await markRefundRequested({ coreTable, order, now });
    // Another request may have marked it first; that time is the stored one.
    const { data: marked } = await coreTable.entities.order
      .get({ orderId: order.orderId })
      .go();
    return { refundRequestedAt: marked?.refundRequestedAt ?? now };
  });

// The caller's most recent paid or refunded order for a course, with what the
// course page needs to show about refunding it. Reads only: no Stripe key.
export const myOrder = courseProcedure
  .input(MyOrderInputSchema)
  .output(MyOrderOutputSchema)
  .query(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const { courseId } = input;
    const userId = ctx.user.sub;

    const { data: orders } = await coreTable.entities.order.query
      .byStudentCourse({ userId, courseId })
      .go({ pages: 'all' });
    const order = orders
      .filter((o) => o.status === 'paid' || o.status === 'refunded')
      .sort((a, b) => (a.orderId < b.orderId ? 1 : -1))[0];
    if (!order?.paidAt) return null;

    const { data: enrolment } = await coreTable.entities.enrolment
      .get({ courseId, userId })
      .go();
    const decision = refundEligibility({
      order,
      enrolment: enrolment ?? { status: 'dropped' },
      connection: await getConnection(coreTable),
      now: new Date().toISOString(),
    });
    const blocked =
      !decision.eligible &&
      (decision.reason === 'window-ended' ||
        decision.reason === 'completed' ||
        decision.reason === 'other-account')
        ? decision.reason
        : undefined;
    return {
      status: order.status as 'paid' | 'refunded',
      amount: order.amount,
      currency: order.currency,
      paidAt: order.paidAt,
      refundWindowDays: REFUND_WINDOW_DAYS,
      refundableUntil: refundDeadline(order.paidAt),
      canRequestRefund: decision.eligible,
      ...(blocked ? { refundBlockedBy: blocked } : {}),
      ...(order.refundRequestedAt
        ? { refundRequestedAt: order.refundRequestedAt }
        : {}),
      ...(order.refundedAt ? { refundedAt: order.refundedAt } : {}),
    };
  });
