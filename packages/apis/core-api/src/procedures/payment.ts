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
  PaymentsUnavailableError,
  startOrder,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { courseProcedure } from '../init.js';
import {
  CheckoutInputSchema,
  CheckoutOutputSchema,
  PaymentAvailableOutputSchema,
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
