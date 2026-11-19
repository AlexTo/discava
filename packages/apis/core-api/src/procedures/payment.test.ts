/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { checkout, paymentAvailable } from './payment.js';

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  connection: undefined as any,
  open: undefined as any,
  orders: [] as any[],
  create: vi.fn(),
  startOrder: vi.fn(),
  attach: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: new Proxy(
      {},
      {
        get: (_, name: string) => ({
          get: () => ({ go: async () => ({ data: mocks.db[name] ?? null }) }),
        }),
      },
    ),
  })),
  getConnection: vi.fn(async () => mocks.connection),
  findOpenOrder: vi.fn(async () => mocks.open),
  // The real helper's connection check, over the mocked connection record.
  startOrder: mocks.startOrder,
  attachCheckoutSession: mocks.attach,
  expireOrder: mocks.expire,
}));

vi.mock('@discava/common-server-utils/stripe/client', () => ({
  withStripe: vi.fn(async (call: (stripe: unknown) => unknown) =>
    call({ checkout: { sessions: { create: mocks.create } } }),
  ),
}));

const router = t.router({ checkout, available: paymentAvailable });
const callerFor = (origin?: string) =>
  t.createCallerFactory(router)({
    event: {
      headers: origin ? { origin } : {},
      requestContext: { authorizer: { claims: { sub: 'student-1' } } },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });
const caller = callerFor('http://localhost:2020');

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
      callerFor('https://evil.example').checkout({ courseId: 'c1' }),
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
