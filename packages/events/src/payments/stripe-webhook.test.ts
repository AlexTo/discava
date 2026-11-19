/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'whsec_testsecret0123';

// An in-memory stand-in for the order helpers that keeps their conditions:
// only a `pending` order moves, whoever calls.
const state = vi.hoisted(() => ({
  orders: new Map<string, any>(),
  enrolments: [] as string[],
  undeliverable: undefined as undefined | 'duplicate' | 'unavailable',
  settleCalls: 0,
  tableError: false,
}));

vi.mock('@discava/core-table', () => ({
  settleOrderPaid: vi.fn(async ({ order, paymentIntentId, now }: any) => {
    state.settleCalls++;
    if (state.tableError) {
      state.tableError = false;
      throw new Error('ProvisionedThroughputExceededException');
    }
    const current = state.orders.get(order.orderId);
    if (current.status !== 'pending') return { result: 'already-settled' };
    if (state.undeliverable) {
      return { result: 'undeliverable', reason: state.undeliverable };
    }
    Object.assign(current, { status: 'paid', paidAt: now, paymentIntentId });
    state.enrolments.push(current.userId);
    return { result: 'fulfilled' };
  }),
  refundUndeliverable: vi.fn(async (_: unknown, order: any, reason: string) => {
    const current = state.orders.get(order.orderId);
    if (current.status === 'pending') {
      Object.assign(current, { status: 'refunded', refundReason: reason });
    }
  }),
}));

vi.mock(
  '@discava/common-server-utils/stripe/secrets',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@discava/common-server-utils/stripe/secrets')
    >()),
    getStripeWebhookSecret: vi.fn(async () => SECRET),
    dropStripeSecretCache: vi.fn(),
  }),
);

import { handleStripeWebhook } from './stripe-webhook.js';
import type { WebhookDeps } from './webhook-deps.js';

const refunds = { create: vi.fn() };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const deps: WebhookDeps = {
  getCoreTable: async () =>
    ({
      entities: {
        order: {
          get: ({ orderId }: { orderId: string }) => ({
            go: async () => ({ data: state.orders.get(orderId) ?? null }),
          }),
        },
      },
    }) as any,
  withStripe: async (call) => call({ refunds } as any),
  now: () => '2026-11-19T09:00:00.000Z',
  logger,
};

const order = () => ({
  orderId: 'o1',
  userId: 'u1',
  courseId: 'c1',
  amount: 4900,
  currency: 'usd',
  status: 'pending',
});

const sessionEvent = (overrides: Record<string, unknown> = {}, id = 'evt_1') =>
  JSON.stringify({
    id,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        object: 'checkout.session',
        payment_status: 'paid',
        client_reference_id: 'o1',
        metadata: { orderId: 'o1', userId: 'u1', courseId: 'c1' },
        amount_total: 4900,
        currency: 'usd',
        payment_intent: 'pi_1',
        ...overrides,
      },
    },
  });

const sign = (body: string, secret = SECRET) =>
  Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
const send = (body: string) => handleStripeWebhook(body, sign(body), deps);

beforeEach(() => {
  vi.clearAllMocks();
  state.orders = new Map([['o1', order()]]);
  state.enrolments = [];
  state.undeliverable = undefined;
  state.settleCalls = 0;
  state.tableError = false;
  refunds.create.mockResolvedValue({ id: 're_1' });
});

describe('checkout.session.completed', () => {
  it('fulfils a paid order', async () => {
    expect(await send(sessionEvent())).toEqual({ status: 200 });
    expect(state.orders.get('o1')).toMatchObject({
      status: 'paid',
      paymentIntentId: 'pi_1',
    });
    expect(state.enrolments).toEqual(['u1']);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('fulfils once for a replay, and for two at once', async () => {
    const body = sessionEvent();
    const results = await Promise.all([send(body), send(body), send(body)]);
    expect(results).toEqual([
      { status: 200 },
      { status: 200 },
      { status: 200 },
    ]);
    expect(await send(body)).toEqual({ status: 200 });
    expect(state.enrolments).toEqual(['u1']);
  });

  it('ignores a session that is not paid', async () => {
    expect(await send(sessionEvent({ payment_status: 'unpaid' }))).toEqual({
      status: 200,
    });
    expect(state.settleCalls).toBe(0);
    expect(state.orders.get('o1').status).toBe('pending');
  });

  it('logs an unknown order as an error and answers 200 with no change', async () => {
    expect(await send(sessionEvent({ client_reference_id: 'nope' }))).toEqual({
      status: 200,
    });
    expect(logger.error).toHaveBeenCalled();
    expect(state.settleCalls).toBe(0);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it.each([['duplicate'], ['unavailable']] as const)(
    'refunds a payment that is %s once, with the idempotency key',
    async (reason) => {
      state.undeliverable = reason;
      expect(await send(sessionEvent())).toEqual({ status: 200 });
      expect(refunds.create).toHaveBeenCalledTimes(1);
      expect(refunds.create).toHaveBeenCalledWith(
        { payment_intent: 'pi_1' },
        { idempotencyKey: 'refund-o1' },
      );
      expect(state.orders.get('o1')).toMatchObject({
        status: 'refunded',
        refundReason: reason,
      });
      expect(state.enrolments).toEqual([]);
    },
  );

  it.each([
    ['amount', { amount_total: 100 }],
    ['currency', { currency: 'eur' }],
    [
      'metadata',
      { metadata: { orderId: 'o1', userId: 'other', courseId: 'c1' } },
    ],
  ])('refunds a %s mismatch in full and enrols nobody', async (_, change) => {
    const body = sessionEvent(change);
    expect(await send(body)).toEqual({ status: 200 });
    expect(refunds.create).toHaveBeenCalledTimes(1);
    const [params, options] = refunds.create.mock.calls[0];
    expect(params).toEqual({ payment_intent: 'pi_1' });
    expect(options).toEqual({ idempotencyKey: 'refund-o1' });
    expect(state.orders.get('o1')).toMatchObject({
      status: 'refunded',
      refundReason: 'mismatch',
    });
    expect(state.settleCalls).toBe(0);
    expect(state.enrolments).toEqual([]);
    expect(logger.error).toHaveBeenCalled();

    // A replay after the refund requests no second one.
    expect(await send(body)).toEqual({ status: 200 });
    expect(refunds.create).toHaveBeenCalledTimes(1);
  });

  it('answers 500 and leaves the order pending when the mismatch refund fails, then the retry completes it', async () => {
    const body = sessionEvent({ amount_total: 100 });
    refunds.create.mockRejectedValueOnce(new Error('stripe is down'));
    expect(await send(body)).toEqual({ status: 500 });
    expect(state.orders.get('o1').status).toBe('pending');
    expect(await send(body)).toEqual({ status: 200 });
    expect(state.orders.get('o1')).toMatchObject({
      status: 'refunded',
      refundReason: 'mismatch',
    });
  });

  it('answers 500 on a table error and succeeds on the retry', async () => {
    const body = sessionEvent();
    state.tableError = true;
    expect(await send(body)).toEqual({ status: 500 });
    expect(state.orders.get('o1').status).toBe('pending');
    expect(await send(body)).toEqual({ status: 200 });
    expect(state.enrolments).toEqual(['u1']);
  });
});

describe('verification', () => {
  it('answers 400 with no writes for a missing header', async () => {
    expect(await handleStripeWebhook(sessionEvent(), undefined, deps)).toEqual({
      status: 400,
    });
    expect(state.settleCalls).toBe(0);
  });

  it('answers 400 for a signature made with another secret', async () => {
    const body = sessionEvent();
    expect(
      await handleStripeWebhook(body, sign(body, 'whsec_other'), deps),
    ).toEqual({ status: 400 });
    expect(state.settleCalls).toBe(0);
  });

  it('answers 400 for a body altered after signing', async () => {
    const body = sessionEvent();
    const header = sign(body);
    expect(
      await handleStripeWebhook(body.replace('4900', '1'), header, deps),
    ).toEqual({ status: 400 });
    expect(state.settleCalls).toBe(0);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('answers 400 for a stale timestamp', async () => {
    const body = sessionEvent();
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(await handleStripeWebhook(body, header, deps)).toEqual({
      status: 400,
    });
  });

  it('answers 200 for an event type it does not act on', async () => {
    const body = JSON.stringify({
      id: 'evt_x',
      object: 'event',
      type: 'customer.created',
      data: { object: {} },
    });
    expect(await send(body)).toEqual({ status: 200 });
    expect(state.settleCalls).toBe(0);
  });
});
