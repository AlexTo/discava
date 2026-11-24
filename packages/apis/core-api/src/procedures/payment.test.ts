/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  checkout,
  myOrder,
  paymentAvailable,
  requestRefund,
} from './payment.js';

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  connection: undefined as any,
  open: undefined as any,
  orders: [] as any[],
  completions: [] as string[],
  create: vi.fn(),
  startOrder: vi.fn(),
  attach: vi.fn(),
  expire: vi.fn(),
  refund: vi.fn(),
  mark: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: new Proxy(
      {},
      {
        get: (_, name: string) => ({
          get: () => ({ go: async () => ({ data: mocks.db[name] ?? null }) }),
          query: {
            byStudentCourse: () => ({
              go: async () => ({ data: mocks.orders }),
            }),
            primary: () => ({
              go: async () => ({
                data: mocks.completions.map((contentItemId) => ({
                  contentItemId,
                })),
              }),
            }),
          },
        }),
      },
    ),
    // A four-item course.
    collections: {
      curriculum: () => ({
        go: async () => ({
          data: {
            module: [{ moduleId: 'm1', visibility: 'visible' }],
            lesson: [{ moduleId: 'm1', lessonId: 'l1', visibility: 'visible' }],
            contentItem: ['i1', 'i2', 'i3', 'i4'].map((contentItemId) => ({
              moduleId: 'm1',
              lessonId: 'l1',
              contentItemId,
              visibility: 'visible',
            })),
          },
        }),
      }),
    },
  })),
  getConnection: vi.fn(async () => mocks.connection),
  findOpenOrder: vi.fn(async () => mocks.open),
  // The real helper's connection check, over the mocked connection record.
  startOrder: mocks.startOrder,
  attachCheckoutSession: mocks.attach,
  expireOrder: mocks.expire,
  markRefundRequested: mocks.mark,
}));

vi.mock('@discava/common-server-utils/stripe/client', () => ({
  withStripe: vi.fn(async (call: (stripe: unknown) => unknown) =>
    call({
      checkout: { sessions: { create: mocks.create } },
      refunds: { create: mocks.refund },
    }),
  ),
}));

const router = t.router({
  checkout,
  available: paymentAvailable,
  requestRefund,
  myOrder,
});
const callerAt = (origin?: string) =>
  callerFor(router, { sub: 'student-1', headers: origin ? { origin } : {} });
const caller = callerAt('http://localhost:2020');

const course = {
  courseId: 'c1',
  title: 'Algebra',
  status: 'published',
  priceAmount: 4900,
  priceCurrency: 'usd',
};
const order = {
  orderId: 'o1',
  userId: 'student-1',
  courseId: 'c1',
  accountId: 'acct_1',
  courseTitle: 'Algebra',
  amount: 4900,
  currency: 'usd',
  status: 'pending',
  expiresAt: '2026-11-19T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = { course };
  mocks.connection = { status: 'active', accountId: 'acct_1' };
  mocks.open = undefined;
  mocks.startOrder.mockResolvedValue(order);
  mocks.create.mockResolvedValue({ id: 'cs_1', url: 'https://pay/cs_1' });
  mocks.attach.mockResolvedValue(true);
  mocks.expire.mockResolvedValue(undefined);
  mocks.orders = [];
  mocks.refund.mockResolvedValue({ id: 're_1' });
  mocks.mark.mockResolvedValue(undefined);
});

describe('payment.checkout', () => {
  it.each([
    ['draft', { ...course, status: 'draft' }],
    ['archived', { ...course, status: 'archived' }],
    ['missing', undefined],
  ])('is NOT_FOUND for a %s course without reaching Stripe', async (_, c) => {
    mocks.db = { course: c };
    await expect(caller.checkout({ courseId: 'c1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('is BAD_REQUEST for a free course', async () => {
    mocks.db = { course: { ...course, priceAmount: 0 } };
    await expect(caller.checkout({ courseId: 'c1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['active', 'completed'])(
    'is CONFLICT for a %s enrolment',
    async (s) => {
      mocks.db.enrolment = { status: s };
      await expect(caller.checkout({ courseId: 'c1' })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(mocks.startOrder).not.toHaveBeenCalled();
    },
  );

  it('lets a dropped student buy', async () => {
    mocks.db.enrolment = { status: 'dropped' };
    await expect(caller.checkout({ courseId: 'c1' })).resolves.toEqual({
      checkoutUrl: 'https://pay/cs_1',
    });
  });

  it("asks Stripe for the course's amount and currency, whatever the input carries", async () => {
    const result = await caller.checkout({
      courseId: 'c1',
      amount: 1,
      currency: 'eur',
    } as any);
    expect(result).toEqual({ checkoutUrl: 'https://pay/cs_1' });
    expect(mocks.startOrder).toHaveBeenCalledWith(
      expect.objectContaining({ course, userId: 'student-1' }),
    );
    const [params, options] = mocks.create.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'payment',
      allowed_payment_method_types: ['card'],
      adaptive_pricing: { enabled: false },
      client_reference_id: 'o1',
      metadata: { orderId: 'o1', userId: 'student-1', courseId: 'c1' },
      payment_intent_data: {
        metadata: { orderId: 'o1', userId: 'student-1', courseId: 'c1' },
      },
      expires_at: Math.floor(Date.parse(order.expiresAt) / 1000),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 4900,
            product_data: { name: 'Algebra' },
          },
        },
      ],
    });
    expect(options).toEqual({ idempotencyKey: 'o1' });
    expect(mocks.attach).toHaveBeenCalledWith(expect.anything(), order, {
      sessionId: 'cs_1',
      url: 'https://pay/cs_1',
    });
  });

  it('uses the allowed origin for the return addresses', async () => {
    await caller.checkout({ courseId: 'c1' });
    const [params] = mocks.create.mock.calls[0];
    expect(params.success_url).toBe(
      'http://localhost:2020/learn/c1?checkout=success',
    );
    expect(params.cancel_url).toBe(
      'http://localhost:2020/learn/c1?checkout=cancelled',
    );
  });

  it('is FORBIDDEN from an origin that is not allowed', async () => {
    await expect(
      callerAt('https://evil.example').checkout({ courseId: 'c1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns the first call's URL on a second call, with one order and one Stripe call", async () => {
    const first = await caller.checkout({ courseId: 'c1' });
    mocks.open = { ...order, checkoutUrl: first.checkoutUrl };
    const second = await caller.checkout({ courseId: 'c1' });
    expect(second).toEqual(first);
    expect(mocks.startOrder).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('expires the order and fails when Stripe does', async () => {
    mocks.create.mockRejectedValue(new Error('boom sk_test_secret'));
    const error = await caller.checkout({ courseId: 'c1' }).catch((e) => e);
    expect(error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't start the payment",
    });
    expect(mocks.expire).toHaveBeenCalledWith(expect.anything(), order);
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it('returns only the checkout URL', async () => {
    expect(Object.keys(await caller.checkout({ courseId: 'c1' }))).toEqual([
      'checkoutUrl',
    ]);
  });

  it.each([
    ['no connection', undefined],
    ['a changing connection', { status: 'changing' }],
    ['a disconnected connection', { status: 'disconnected' }],
  ])('is PRECONDITION_FAILED with %s, with no Stripe call', async (_, c) => {
    mocks.connection = c;
    const { PaymentsUnavailableError } = await import('@discava/core-table');
    mocks.startOrder.mockRejectedValue(new PaymentsUnavailableError());
    await expect(caller.checkout({ courseId: 'c1' })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Payments are unavailable right now',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("stores the connection's account on the order it starts", async () => {
    await caller.checkout({ courseId: 'c1' });
    const { getConnection } = mocks.startOrder.mock.calls[0][0];
    expect(await getConnection()).toMatchObject({ accountId: 'acct_1' });
  });
});

describe('payment.available', () => {
  it.each([
    ['no connection', undefined, false],
    ['changing', { status: 'changing' }, false],
    ['disconnected', { status: 'disconnected' }, false],
    ['active', { status: 'active' }, true],
  ])('is %s: %s', async (_, connection, available) => {
    mocks.connection = connection;
    expect(await caller.available()).toEqual({ available });
  });
});

describe('refunds', () => {
  const NOW = new Date('2026-11-10T00:00:00.000Z');
  const PAID = '2026-11-05T00:00:00.000Z';
  const paid = {
    ...order,
    status: 'paid',
    paidAt: PAID,
    paymentIntentId: 'pi_1',
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.db = {
      course,
      enrolment: { status: 'active', orderId: 'o1' },
      order: paid,
    };
    mocks.orders = [paid];
    mocks.completions = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('payment.requestRefund', () => {
    it('asks Stripe once for the whole amount, then marks the order', async () => {
      mocks.mark.mockImplementation(async () => {
        mocks.db.order = { ...paid, refundRequestedAt: NOW.toISOString() };
      });
      const result = await caller.requestRefund({ courseId: 'c1' });
      expect(result).toEqual({ refundRequestedAt: NOW.toISOString() });
      expect(mocks.refund).toHaveBeenCalledTimes(1);
      expect(mocks.refund).toHaveBeenCalledWith(
        { payment_intent: 'pi_1', amount: 4900 },
        { idempotencyKey: 'refund-o1' },
      );
      expect(mocks.mark).toHaveBeenCalledWith(
        expect.objectContaining({
          order: expect.objectContaining({ orderId: 'o1' }),
          now: NOW.toISOString(),
        }),
      );
    });

    it('refunds only what has not been refunded yet', async () => {
      mocks.db.order = { ...paid, refundedAmount: 1000 };
      await caller.requestRefund({ courseId: 'c1' });
      expect(mocks.refund).toHaveBeenCalledWith(
        { payment_intent: 'pi_1', amount: 3900 },
        { idempotencyKey: 'refund-o1' },
      );
    });

    it('returns the stored time and makes no second Stripe call when already requested', async () => {
      mocks.db.order = { ...paid, refundRequestedAt: PAID };
      await expect(caller.requestRefund({ courseId: 'c1' })).resolves.toEqual({
        refundRequestedAt: PAID,
      });
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.mark).not.toHaveBeenCalled();
    });

    it.each([
      ['no enrolment', { enrolment: undefined }],
      ['a free enrolment', { enrolment: { status: 'active' } }],
      ['no order', { order: undefined }],
      [
        "another student's order",
        { order: { ...paid, userId: 'someone-else' } },
      ],
      ['another course', { order: { ...paid, courseId: 'c2' } }],
    ])('is NOT_FOUND for %s and never reaches Stripe', async (_, change) => {
      mocks.db = { ...mocks.db, ...change };
      await expect(
        caller.requestRefund({ courseId: 'c1' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'No purchase to refund',
      });
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.mark).not.toHaveBeenCalled();
    });

    it.each([
      [
        'past the window',
        { order: { ...paid, paidAt: '2026-10-01T00:00:00.000Z' } },
        'The 14-day refund period for this course has ended',
      ],
      [
        'a completed enrolment',
        { enrolment: { status: 'completed', orderId: 'o1' } },
        "A course can't be refunded after you have completed it",
      ],
      [
        'an order from another account',
        { order: { ...paid, accountId: 'acct_2' } },
        "This purchase can't be refunded here right now",
      ],
      [
        'an enrolment on another order',
        { enrolment: { status: 'active', orderId: 'o2' } },
        'No purchase to refund',
      ],
      [
        'an order that is no longer paid',
        { order: { ...paid, status: 'refunded' } },
        'No purchase to refund',
      ],
    ])('refuses %s and never reaches Stripe', async (_, change, message) => {
      mocks.db = { ...mocks.db, ...change };
      await expect(
        caller.requestRefund({ courseId: 'c1' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message });
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.mark).not.toHaveBeenCalled();
    });

    it.each([
      [
        'half the course done',
        { completions: ['i1', 'i2'] },
        "A course can't be refunded after you have completed half of it",
      ],
      [
        'an earlier refund at the student request',
        {
          orders: [
            {
              ...paid,
              orderId: 'o0',
              status: 'refunded',
              refundReason: 'requested',
              refundRequestedAt: PAID,
            },
            paid,
          ],
        },
        "You were refunded for this course before, so this purchase can't be refunded",
      ],
    ])('refuses %s and never reaches Stripe', async (_, change, message) => {
      Object.assign(mocks, change);
      await expect(
        caller.requestRefund({ courseId: 'c1' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message });
      expect(mocks.refund).not.toHaveBeenCalled();
      expect(mocks.mark).not.toHaveBeenCalled();
    });

    it('decides on the completions, not the stored progress', async () => {
      mocks.db.enrolment = {
        status: 'active',
        orderId: 'o1',
        progressPercent: 40,
      };
      mocks.completions = ['i1', 'i2'];
      await expect(
        caller.requestRefund({ courseId: 'c1' }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(mocks.refund).not.toHaveBeenCalled();
    });

    it('refunds a student at a quarter of the course, and after an operator refund', async () => {
      mocks.completions = ['i1'];
      mocks.orders = [
        {
          ...paid,
          orderId: 'o0',
          status: 'refunded',
          refundReason: 'requested',
        },
        paid,
      ];
      await caller.requestRefund({ courseId: 'c1' });
      expect(mocks.refund).toHaveBeenCalledTimes(1);
    });

    it('refuses when payments are not connected', async () => {
      mocks.connection = undefined;
      await expect(
        caller.requestRefund({ courseId: 'c1' }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: "This purchase can't be refunded here right now",
      });
      expect(mocks.refund).not.toHaveBeenCalled();
    });

    it('writes nothing when Stripe fails', async () => {
      mocks.refund.mockRejectedValue(new Error('card_declined sk_live_secret'));
      const error = await caller
        .requestRefund({ courseId: 'c1' })
        .catch((e) => e);
      expect(error).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: "Couldn't request the refund",
      });
      expect(JSON.stringify(error.message)).not.toContain('sk_live');
      expect(mocks.mark).not.toHaveBeenCalled();
    });
  });

  describe('payment.myOrder', () => {
    it('is null with no paid or refunded order', async () => {
      mocks.orders = [{ ...order, status: 'pending' }];
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toBeNull();
      mocks.orders = [];
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toBeNull();
    });

    it("returns only the contract's fields", async () => {
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toEqual({
        status: 'paid',
        amount: 4900,
        currency: 'usd',
        paidAt: PAID,
        refundWindowDays: 14,
        refundableUntil: '2026-11-19T00:00:00.000Z',
        refundProgressLimitPercent: 50,
        canRequestRefund: true,
      });
    });

    it('says why a refund is blocked, and shows a request and a refund', async () => {
      mocks.db.enrolment = { status: 'completed', orderId: 'o1' };
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toMatchObject({
        canRequestRefund: false,
        refundBlockedBy: 'completed',
      });

      mocks.db.enrolment = { status: 'active', orderId: 'o1' };
      mocks.orders = [{ ...paid, paidAt: '2026-10-01T00:00:00.000Z' }];
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toMatchObject({
        refundBlockedBy: 'window-ended',
      });

      mocks.orders = [{ ...paid, refundRequestedAt: PAID }];
      const requested = await caller.myOrder({ courseId: 'c1' });
      expect(requested).toMatchObject({
        canRequestRefund: false,
        refundRequestedAt: PAID,
      });
      expect(requested).not.toHaveProperty('refundBlockedBy');

      mocks.orders = [
        { ...paid, status: 'refunded', refundedAt: NOW.toISOString() },
      ];
      mocks.db.enrolment = { status: 'dropped', orderId: 'o1' };
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toMatchObject({
        status: 'refunded',
        canRequestRefund: false,
        refundedAt: NOW.toISOString(),
      });
    });

    it('says progress and an earlier refund block a refund, as requestRefund decides', async () => {
      mocks.completions = ['i1', 'i2'];
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toMatchObject({
        canRequestRefund: false,
        refundBlockedBy: 'progress-limit',
        refundProgressLimitPercent: 50,
      });

      mocks.completions = [];
      mocks.orders = [
        {
          ...paid,
          orderId: 'o0',
          status: 'refunded',
          refundReason: 'requested',
          refundRequestedAt: PAID,
        },
        paid,
      ];
      await expect(caller.myOrder({ courseId: 'c1' })).resolves.toMatchObject({
        canRequestRefund: false,
        refundBlockedBy: 'refunded-before',
      });
    });

    it('returns the most recent order and never exposes the order, intent or account', async () => {
      mocks.orders = [
        { ...paid, orderId: 'o0', status: 'refunded', amount: 1000 },
        { ...paid, orderId: 'o9' },
      ];
      const result = await caller.myOrder({ courseId: 'c1' });
      expect(result).toMatchObject({ status: 'paid', amount: 4900 });
      expect(JSON.stringify(result)).not.toMatch(/pi_1|acct_1|o9|orderId/);
    });
  });
});
