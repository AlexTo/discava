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
  // The enrolment's state, as the real refund keeps it.
  enrolment: undefined as any,
  undeliverable: undefined as undefined | 'duplicate' | 'unavailable',
  settleCalls: 0,
  tableError: false,
  // Notifications by `<userId>:<dedupeKey>`, as publishNotification keeps them.
  notifications: new Map<string, any>(),
  publishError: false,
}));

vi.mock('@discava/core-table', () => ({
  expireOrder: vi.fn(async (_: unknown, order: any) => {
    const current = state.orders.get(order.orderId);
    if (current.status === 'pending') current.status = 'expired';
  }),
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
  refundOrder: vi.fn(async ({ order, refundedTotal, now, eventAt }: any) => {
    const current = state.orders.get(order.orderId);
    if (!current) throw new Error('Not found');
    if (current.status !== 'paid') return;
    if (current.refundFailedAt && eventAt <= current.refundFailedAt) return;
    if (refundedTotal >= current.amount) {
      Object.assign(current, {
        status: 'refunded',
        refundReason: 'requested',
        refundedAt: now,
        refundedAmount: current.amount,
      });
      if (state.enrolment?.orderId === current.orderId) {
        state.enrolment.status = 'dropped';
      }
    } else if (refundedTotal > (current.refundedAmount ?? 0)) {
      current.refundedAmount = refundedTotal;
    }
  }),
  markRefundFailed: vi.fn(async ({ order, now }: any) => {
    const current = state.orders.get(order.orderId);
    if (current.status === 'paid' && current.refundRequestedAt) {
      const first = !current.refundFailedAt;
      current.refundFailedAt ??= now;
      return first;
    }
    return false;
  }),
  reverseRefund: vi.fn(async ({ order, now }: any) => {
    const current = state.orders.get(order.orderId);
    if (current.status !== 'refunded' || current.refundReason !== 'requested') {
      return false;
    }
    Object.assign(current, { status: 'paid', refundFailedAt: now });
    current.refundedAt = undefined;
    current.refundedAmount = undefined;
    if (state.enrolment?.orderId === current.orderId) {
      state.enrolment.status = 'active';
    }
    return true;
  }),
  publishNotification: vi.fn(async (_: unknown, input: any) => {
    if (state.publishError) {
      state.publishError = false;
      throw new Error('TransactionConflict');
    }
    const key = `${input.userId}:${input.type}:${input.dedupeKey}`;
    if (state.notifications.has(key)) return 'duplicate';
    state.notifications.set(key, input);
    return 'created';
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
const paymentIntents = { retrieve: vi.fn() };
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
        enrolment: {
          get: () => ({ go: async () => ({ data: state.enrolment ?? null }) }),
        },
      },
    }) as any,
  withStripe: async (call) => call({ refunds, paymentIntents } as any),
  now: () => '2026-11-19T09:00:00.000Z',
  logger,
};

const order = () => ({
  orderId: 'o1',
  userId: 'u1',
  courseId: 'c1',
  courseTitle: 'Algebra',
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
  state.enrolment = undefined;
  state.notifications = new Map();
  state.publishError = false;
  refunds.create.mockResolvedValue({ id: 're_1' });
  paymentIntents.retrieve.mockResolvedValue({
    id: 'pi_1',
    metadata: { orderId: 'o1' },
  });
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

describe('checkout.session.expired', () => {
  const expiredEvent = (
    clientReferenceId: string | null = 'o1',
    id = 'evt_x',
  ) =>
    JSON.stringify({
      id,
      object: 'event',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_1',
          object: 'checkout.session',
          payment_status: 'unpaid',
          client_reference_id: clientReferenceId,
        },
      },
    });

  it('moves a pending order to expired, and a repeat changes nothing', async () => {
    expect(await send(expiredEvent())).toEqual({ status: 200 });
    expect(state.orders.get('o1')?.status).toBe('expired');
    expect(await send(expiredEvent())).toEqual({ status: 200 });
    expect(state.orders.get('o1')?.status).toBe('expired');
    expect(state.enrolments).toEqual([]);
    expect(refunds.create).not.toHaveBeenCalled();
  });

  it('leaves a paid order alone', async () => {
    await send(sessionEvent());
    expect(await send(expiredEvent())).toEqual({ status: 200 });
    expect(state.orders.get('o1')?.status).toBe('paid');
  });

  it('logs an unknown order and answers 200', async () => {
    expect(await send(expiredEvent('nope'))).toEqual({ status: 200 });
    expect(logger.error).toHaveBeenCalled();
    expect(state.orders.get('o1')?.status).toBe('pending');
  });
});

describe('charge.refunded', () => {
  const refundedEvent = (amountRefunded: number, id = 'evt_r') =>
    JSON.stringify({
      id,
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          object: 'charge',
          payment_intent: 'pi_1',
          amount: 4900,
          amount_refunded: amountRefunded,
        },
      },
    });

  beforeEach(() => {
    state.orders.set('o1', {
      ...order(),
      status: 'paid',
      paymentIntentId: 'pi_1',
    });
    state.enrolment = {
      orderId: 'o1',
      status: 'completed',
      completedAt: '2026-11-18T00:00:00.000Z',
      progressPercent: 100,
    };
  });

  it('does not refund again from a notice created before the refund failed', async () => {
    Object.assign(state.orders.get('o1'), {
      refundRequestedAt: '2026-11-19T08:00:00.000Z',
      refundFailedAt: '2026-11-19T09:00:00.000Z',
    });
    const body = JSON.parse(refundedEvent(4900));
    body.created = Date.parse('2026-11-19T08:30:00.000Z') / 1000;
    await send(JSON.stringify(body));
    expect(state.orders.get('o1')?.status).toBe('paid');
    expect(state.enrolment?.status).not.toBe('dropped');
    expect(state.notifications.size).toBe(0);
  });

  it('ends the order and the enrolment on a full refund, keeping progress', async () => {
    expect(await send(refundedEvent(4900))).toEqual({ status: 200 });
    expect(paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
    expect(state.orders.get('o1')).toMatchObject({
      status: 'refunded',
      refundReason: 'requested',
      refundedAmount: 4900,
    });
    expect(state.enrolment).toMatchObject({
      status: 'dropped',
      completedAt: '2026-11-18T00:00:00.000Z',
      progressPercent: 100,
    });
  });

  it('tells the student once, whether they asked or an operator refunded', async () => {
    await send(refundedEvent(4900));
    expect([...state.notifications.values()]).toEqual([
      {
        type: 'order.refunded',
        userId: 'u1',
        params: { courseTitle: 'Algebra', courseId: 'c1', amount: '$49.00' },
        dedupeKey: 'o1',
        occurredAt: '2026-11-19T09:00:00.000Z',
      },
    ]);
    // The student asked: refundRequestedAt is set. The notice is the same.
    state.notifications.clear();
    state.orders.set('o1', {
      ...order(),
      status: 'paid',
      paymentIntentId: 'pi_1',
      refundRequestedAt: '2026-11-19T08:00:00.000Z',
    });
    state.enrolment = { orderId: 'o1', status: 'active' };
    await send(refundedEvent(4900, 'evt_r2'));
    expect([...state.notifications.values()]).toHaveLength(1);
    expect([...state.notifications.values()][0].params).toEqual({
      courseTitle: 'Algebra',
      courseId: 'c1',
      amount: '$49.00',
    });
  });

  it('publishes one notification for the same notice twice', async () => {
    await send(refundedEvent(4900));
    await send(refundedEvent(4900));
    expect(state.notifications.size).toBe(1);
  });

  it('publishes nothing for a partial refund', async () => {
    await send(refundedEvent(1000));
    expect(state.notifications.size).toBe(0);
  });

  it.each(['duplicate', 'unavailable', 'mismatch'])(
    'publishes nothing for an automatic refund (%s)',
    async (refundReason) => {
      state.orders.set('o1', {
        ...order(),
        status: 'refunded',
        refundReason,
        refundedAt: '2026-11-19T08:00:00.000Z',
      });
      await send(refundedEvent(4900));
      expect(state.notifications.size).toBe(0);
    },
  );

  it('publishes nothing when the enrolment names another order', async () => {
    state.enrolment = { orderId: 'o2', status: 'active' };
    await send(refundedEvent(4900));
    expect(state.notifications.size).toBe(0);
  });

  it('fails the delivery when the publish fails, and the redelivery publishes exactly one', async () => {
    state.publishError = true;
    expect(await send(refundedEvent(4900))).toEqual({ status: 500 });
    expect(state.orders.get('o1')?.status).toBe('refunded');
    expect(state.notifications.size).toBe(0);
    expect(await send(refundedEvent(4900))).toEqual({ status: 200 });
    expect(state.notifications.size).toBe(1);
  });

  it('only records the amount on a partial refund', async () => {
    expect(await send(refundedEvent(1000))).toEqual({ status: 200 });
    expect(state.orders.get('o1')).toMatchObject({
      status: 'paid',
      refundedAmount: 1000,
    });
    expect(state.enrolment.status).toBe('completed');
  });

  it('changes nothing for the same notice twice', async () => {
    await send(refundedEvent(4900));
    const after = structuredClone(state.orders.get('o1'));
    expect(await send(refundedEvent(4900))).toEqual({ status: 200 });
    expect(state.orders.get('o1')).toEqual(after);
  });

  it('changes nothing for the notice our own automatic refund causes', async () => {
    state.orders.set('o1', {
      ...order(),
      status: 'refunded',
      refundReason: 'duplicate',
      refundedAt: '2026-11-19T08:00:00.000Z',
    });
    const before = structuredClone(state.orders.get('o1'));
    expect(await send(refundedEvent(4900))).toEqual({ status: 200 });
    expect(state.orders.get('o1')).toEqual(before);
  });

  it("does not end a newer enrolment for an old order's notice", async () => {
    state.enrolment = { orderId: 'o2', status: 'active' };
    expect(await send(refundedEvent(4900))).toEqual({ status: 200 });
    expect(state.orders.get('o1')?.status).toBe('refunded');
    expect(state.enrolment).toEqual({ orderId: 'o2', status: 'active' });
  });

  it('logs an unknown order and answers 200', async () => {
    paymentIntents.retrieve.mockResolvedValue({ id: 'pi_1', metadata: {} });
    expect(await send(refundedEvent(4900))).toEqual({ status: 200 });
    expect(logger.error).toHaveBeenCalled();
    expect(state.orders.get('o1')?.status).toBe('paid');
  });

  it('answers 500 when Stripe cannot be asked, so it retries', async () => {
    paymentIntents.retrieve.mockRejectedValue(new Error('timeout'));
    expect(await send(refundedEvent(4900))).toEqual({ status: 500 });
  });
});

describe('a failed refund', () => {
  const failedEvent = (type: string, status = 'failed', id = 'evt_f') =>
    JSON.stringify({
      id,
      object: 'event',
      type,
      data: {
        object: {
          id: 're_1',
          object: 'refund',
          payment_intent: 'pi_1',
          status,
        },
      },
    });

  beforeEach(() => {
    state.orders.set('o1', {
      ...order(),
      status: 'paid',
      paymentIntentId: 'pi_1',
      refundRequestedAt: '2026-11-19T08:00:00.000Z',
    });
  });

  it.each(['refund.failed', 'charge.refund.updated'])(
    'records the failure on the order from %s, leaving it paid',
    async (type) => {
      expect(await send(failedEvent(type))).toEqual({ status: 200 });
      expect(state.orders.get('o1')).toMatchObject({
        status: 'paid',
        refundFailedAt: '2026-11-19T09:00:00.000Z',
      });
    },
  );

  it('logs the recorded failure once, not again after a no-op', async () => {
    await send(failedEvent('refund.failed'));
    await send(failedEvent('refund.failed'));
    const recorded = logger.info.mock.calls.filter(
      (call) => call[0] === 'Refund failure recorded',
    );
    expect(recorded).toHaveLength(1);
  });

  it('undoes a refund that charge.refunded already applied, once', async () => {
    const order = state.orders.get('o1');
    Object.assign(order, {
      status: 'refunded',
      refundReason: 'requested',
      refundedAt: '2026-11-19T08:00:01.000Z',
      refundedAmount: 1000,
    });
    await send(failedEvent('refund.failed'));
    await send(failedEvent('refund.failed'));
    expect(state.orders.get('o1')).toMatchObject({
      status: 'paid',
      refundFailedAt: '2026-11-19T09:00:00.000Z',
    });
    expect(
      logger.info.mock.calls.filter(
        (call) => call[0] === 'Refund failure recorded',
      ),
    ).toHaveLength(1);
    expect(state.notifications.size).toBe(1);
    expect([...state.notifications.values()][0]).toMatchObject({
      type: 'order.refund_failed',
      dedupeKey: 'o1',
    });
  });

  it('ignores a refund update that is not a failure', async () => {
    await send(failedEvent('charge.refund.updated', 'succeeded'));
    expect(state.orders.get('o1')?.refundFailedAt).toBeUndefined();
  });

  it('records nothing for an order with no refund request', async () => {
    state.orders.get('o1').refundRequestedAt = undefined;
    await send(failedEvent('refund.failed'));
    expect(state.orders.get('o1')?.refundFailedAt).toBeUndefined();
  });

  it('reads the payment intent from an expanded object too', async () => {
    const body = JSON.stringify({
      id: 'evt_f2',
      object: 'event',
      type: 'refund.failed',
      data: {
        object: {
          id: 're_1',
          object: 'refund',
          payment_intent: { id: 'pi_1' },
          status: 'failed',
        },
      },
    });
    await send(body);
    expect(paymentIntents.retrieve).toHaveBeenCalledWith('pi_1');
    expect(state.orders.get('o1')?.refundFailedAt).toBeDefined();
  });

  it('records nothing for a refund with no payment intent', async () => {
    const body = JSON.stringify({
      id: 'evt_f3',
      object: 'event',
      type: 'refund.failed',
      data: {
        object: {
          id: 're_1',
          object: 'refund',
          payment_intent: null,
          status: 'failed',
        },
      },
    });
    expect(await send(body)).toEqual({ status: 200 });
    expect(state.orders.get('o1')?.refundFailedAt).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('answers 200 for an unknown order', async () => {
    state.orders.clear();
    expect(await send(failedEvent('refund.failed'))).toEqual({ status: 200 });
    expect(logger.error).toHaveBeenCalled();
  });
});
