/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import { localCheckoutTtlSeconds } from '@discava/common-server-utils/local-dev';
import { withStripe } from '@discava/common-server-utils/stripe/client';
import {
  attachCheckoutSession,
  CheckoutStartCancelledError,
  COUPON_REFUSALS,
  claimCouponWrites,
  expireOrder,
  expireOrderWrites,
  findOpenOrder,
  getConnection,
  markRefundRequested,
  normaliseCouponCode,
  type OrderRecord,
  PaymentsUnavailableError,
  REFUND_WINDOW_DAYS,
  reclaimExpiredReservations,
  refundDeadline,
  refundEligibility,
  startOrder,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { checkCoupon } from '../helpers/coupon-check.js';
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
    const { courseId, couponCode } = input;
    const userId = ctx.user.sub;

    const origin = getAllowedOrigin(ctx.event);
    if (!origin) throw new TRPCError({ code: 'FORBIDDEN' });

    if (couponCode !== undefined) {
      return checkoutWithCoupon({
        coreTable,
        userId,
        courseId,
        couponCode,
        origin,
      });
    }

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

    return createSession({ coreTable, order, userId, courseId, origin });
  });

type CoreTable = Parameters<typeof findOpenOrder>[0]['coreTable'];

// A reservation outlives its session by this long, so it is never released
// while the session can still be paid.
const RESERVATION_GRACE_MS = 5 * 60 * 1000;
const CONFLICT_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const refuse = (message: string) =>
  new TRPCError({ code: 'PRECONDITION_FAILED', message });

type StripeSessionState = 'expired' | 'complete' | 'open';

// Expires every earlier unpaid order's session, so a student has one live
// checkout and a replaced one can never be paid. Nothing is written. "Already
// expired" is success; "already complete" means the student has paid (the
// caller answers "already enrolled"); any other failure is retryable and
// leaves everything as it was.
const expireEarlierSessions = async (orders: OrderRecord[], now: string) => {
  for (const earlier of orders) {
    if (!earlier.checkoutSessionId) {
      // It may be mid-creation in another request.
      if (earlier.expiresAt > now) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Your earlier checkout is still starting; try again',
        });
      }
      continue;
    }
    const sessionId = earlier.checkoutSessionId;
    try {
      await withStripe((stripe) => stripe.checkout.sessions.expire(sessionId));
    } catch {
      const state = await withStripe(
        async (stripe): Promise<StripeSessionState> =>
          (await stripe.checkout.sessions.retrieve(sessionId))
            .status as StripeSessionState,
      ).catch(() => 'open' as const);
      if (state === 'complete') {
        throw refuse(COUPON_REFUSALS.alreadyEnrolled);
      }
      if (state !== 'expired') {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "Couldn't replace your earlier checkout; try again",
        });
      }
    }
  }
};

// A checkout with a discount code (total above zero). The code is validated
// as `coupon.preview` does and the amount is the server's own, never the
// browser's. The claim on the code and the order are one transaction; an
// earlier unpaid order's session is expired first, and the order, and its
// reservation, are only replaced after that succeeded.
const checkoutWithCoupon = async ({
  coreTable,
  userId,
  courseId,
  couponCode,
  origin,
}: {
  coreTable: CoreTable;
  userId: string;
  courseId: string;
  couponCode: string;
  origin: string;
}) => {
  let reclaimed = false;
  let conflicts = 0;
  for (;;) {
    const now = new Date().toISOString();
    let check: Awaited<ReturnType<typeof checkCoupon>>;
    try {
      check = await checkCoupon({
        coreTable,
        courseId,
        userId,
        input: couponCode,
        now,
      });
    } catch (error) {
      // Reservations whose checkout ended may be what fills the code.
      if (
        !reclaimed &&
        error instanceof TRPCError &&
        error.message === COUPON_REFUSALS.usedUp
      ) {
        reclaimed = true;
        const { data: coupon } = await coreTable.entities.coupon
          .get({ courseId, code: normaliseCouponCode(couponCode) as string })
          .go();
        if (coupon) {
          await reclaimExpiredReservations({
            coreTable,
            courseId,
            code: coupon.code,
            now,
          });
        }
        continue;
      }
      throw error;
    }
    if (check.price.isFree) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A code that makes the course free is not supported here yet',
      });
    }

    const { data: orders } = await coreTable.entities.order.query
      .byStudentCourse({ userId, courseId })
      .go({ pages: 'all' });
    const pending = (orders as OrderRecord[]).filter(
      (o) => o.status === 'pending',
    );
    const open = await findOpenOrder({ coreTable, userId, courseId, now });
    if (open?.checkoutUrl && open.couponCode === check.code) {
      return { checkoutUrl: open.checkoutUrl };
    }

    await expireEarlierSessions(pending, now);

    // An earlier order on the same code holds the very redemption this one
    // claims, which one transaction cannot both release and create: end it
    // first. Another order on a different (or no) code is replaced inside the
    // new order's transaction.
    const sameCode = pending.filter((o) => o.couponCode === check.code);
    for (const earlier of sameCode) {
      await coreTable.transaction
        .write((entities) => expireOrderWrites(entities, earlier))
        .go();
    }
    const others = pending.filter((o) => o.couponCode !== check.code);

    let order: OrderRecord;
    try {
      order = await startOrder({
        coreTable,
        course: check.course,
        userId,
        now,
        getConnection: () => getConnection(coreTable),
        ttlSeconds: localCheckoutTtlSeconds(),
        discount: {
          discountAmount: check.price.discountAmount,
          couponCode: check.code,
          couponType: check.coupon.type,
          couponValue: check.coupon.value,
        },
        extraWrites: (entities, created) => [
          ...claimCouponWrites(entities, {
            coupon: check.coupon,
            userId,
            orderId: created.orderId,
            status: 'reserved',
            now,
            reservedUntil: new Date(
              new Date(created.expiresAt).getTime() + RESERVATION_GRACE_MS,
            ).toISOString(),
          }),
          ...others.flatMap((earlier) => expireOrderWrites(entities, earlier)),
        ],
      });
    } catch (error) {
      if (error instanceof PaymentsUnavailableError) {
        throw refuse('Payments are unavailable right now');
      }
      if (!(error instanceof CheckoutStartCancelledError)) throw error;
      // Nothing was written. The next pass validates again, which answers
      // with the matching refusal if the code was taken in the meantime; if it
      // still passes, another writer got in the way.
      if (++conflicts >= CONFLICT_ATTEMPTS) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Too many people are checking out; try again',
        });
      }
      await sleep(50 + Math.floor(Math.random() * 100));
      continue;
    }

    return createSession({ coreTable, order, userId, courseId, origin });
  }
};

// Creates Stripe's hosted page for an order at the order's own amount and
// stores it on the order. If Stripe fails the order is expired, which also
// releases any coupon claim it holds.
const createSession = async ({
  coreTable,
  order,
  userId,
  courseId,
  origin,
}: {
  coreTable: CoreTable;
  order: OrderRecord;
  userId: string;
  courseId: string;
  origin: string;
}) => {
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
};

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
