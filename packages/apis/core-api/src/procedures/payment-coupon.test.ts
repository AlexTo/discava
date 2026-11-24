/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import {
  CheckoutStartCancelledError,
  NotFoundError,
  PaymentsUnavailableError,
} from '@discava/core-table';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { checkout } from './payment.js';

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  orders: [] as any[],
  open: undefined as any,
  calls: [] as string[],
  composed: [] as any[],
  startOrder: vi.fn(),
  startFree: vi.fn(),
  create: vi.fn(),
  expireSession: vi.fn(),
  retrieveSession: vi.fn(),
  attach: vi.fn(),
  expireOrder: vi.fn(),
  reclaim: vi.fn(),
  claim: vi.fn(),
  expireWrites: vi.fn(),
  transaction: vi.fn(),
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
          },
        }),
      },
    ),
    transaction: {
      write: (build: (entities: unknown) => unknown) => ({
        go: async () => {
          mocks.transaction(build({}));
          return { canceled: false };
        },
      }),
    },
  })),
  getConnection: vi.fn(async () => ({ status: 'active', accountId: 'acct_1' })),
  findOpenOrder: vi.fn(async () => mocks.open),
  startOrder: mocks.startOrder,
  startFreeOrder: mocks.startFree,
  attachCheckoutSession: mocks.attach,
  expireOrder: mocks.expireOrder,
  reclaimExpiredReservations: mocks.reclaim,
  claimCouponWrites: mocks.claim,
  expireOrderWrites: mocks.expireWrites,
}));

vi.mock('@discava/common-server-utils/stripe/client', () => ({
  withStripe: vi.fn(async (call: (stripe: unknown) => unknown) =>
    call({
      checkout: {
        sessions: {
          create: mocks.create,
          expire: mocks.expireSession,
          retrieve: mocks.retrieveSession,
        },
      },
    }),
  ),
}));

const caller = callerFor(t.router({ checkout }), {
  sub: 'student-1',
  headers: { origin: 'http://localhost:2020' },
});

const course = {
  courseId: 'c1',
  title: 'Algebra',
  status: 'published',
  priceAmount: 4900,
  priceCurrency: 'usd',
};
const coupon = {
  courseId: 'c1',
  code: 'SPRING-20',
  type: 'percent',
  value: 20,
  enabled: true,
  redeemedCount: 0,
};
const created = {
  orderId: 'new',
  userId: 'student-1',
  courseId: 'c1',
  courseTitle: 'Algebra',
  listAmount: 4900,
  amount: 3920,
  currency: 'usd',
  status: 'pending',
  expiresAt: '2026-11-19T10:00:00.000Z',
};
const earlier = (over: Record<string, unknown> = {}) => ({
  orderId: 'old',
  userId: 'student-1',
  courseId: 'c1',
  status: 'pending',
  checkoutSessionId: 'cs_old',
  checkoutUrl: 'https://pay/cs_old',
  expiresAt: '2099-01-01T00:00:00.000Z',
  ...over,
});

const start = (couponCode = 'spring-20', extra: object = {}) =>
  caller.checkout({ courseId: 'c1', couponCode, ...extra } as never);
const refused = (message: string) =>
  expect.objectContaining({ code: 'PRECONDITION_FAILED', message });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = { course, coupon };
  mocks.orders = [];
  mocks.open = undefined;
  mocks.composed = [];
  mocks.calls = [];
  mocks.claim.mockImplementation((_e, claim) => [{ claim }]);
  mocks.expireWrites.mockImplementation((_e, order) => [{ expire: order }]);
  mocks.startOrder.mockImplementation(async (args: any) => {
    mocks.calls.push('startOrder');
    mocks.composed = args.extraWrites({}, created);
    return created;
  });
  mocks.startFree.mockImplementation(async (args: any) => {
    mocks.calls.push('startFreeOrder');
    mocks.composed = args.extraWrites({}, { ...created, amount: 0 });
    return { ...created, amount: 0, status: 'paid' };
  });
  mocks.create.mockResolvedValue({ id: 'cs_new', url: 'https://pay/cs_new' });
  mocks.expireSession.mockImplementation(async () => {
    mocks.calls.push('expireSession');
  });
  mocks.attach.mockResolvedValue(true);
  mocks.expireOrder.mockResolvedValue(undefined);
  mocks.reclaim.mockResolvedValue(0);
});

describe('payment.checkout with a code', () => {
  it('charges the server total whatever the browser sent, and snapshots the discount', async () => {
    expect(await start('spring-20', { amount: 1 })).toEqual({
      checkoutUrl: 'https://pay/cs_new',
    });
    expect(mocks.startOrder.mock.calls[0]?.[0]).toMatchObject({
      discount: {
        discountAmount: 980,
        couponCode: 'SPRING-20',
        couponType: 'percent',
        couponValue: 20,
      },
    });
    expect(
      mocks.create.mock.calls[0]?.[0].line_items[0].price_data,
    ).toMatchObject({ unit_amount: 3920, currency: 'usd' });
    expect(mocks.attach).toHaveBeenCalled();
  });

  it('claims the code in the order transaction, reserved until the session ends plus 5 minutes', async () => {
    await start();
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'student-1',
        orderId: 'new',
        status: 'reserved',
        reservedUntil: '2026-11-19T10:05:00.000Z',
      }),
    );
    expect(mocks.composed).toHaveLength(1);
  });

  it('returns the open order for a repeat with the same code', async () => {
    mocks.orders = [earlier({ couponCode: 'SPRING-20' })];
    mocks.open = mocks.orders[0];
    expect(await start()).toEqual({ checkoutUrl: 'https://pay/cs_old' });
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.expireSession).not.toHaveBeenCalled();
  });

  it('expires the earlier session first, then replaces its order in the new transaction', async () => {
    mocks.orders = [earlier({ couponCode: 'OTHER' })];
    mocks.open = mocks.orders[0];
    await start();
    expect(mocks.expireSession).toHaveBeenCalledWith('cs_old');
    expect(mocks.calls).toEqual(['expireSession', 'startOrder']);
    expect(mocks.expireWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'old', couponCode: 'OTHER' }),
    );
    expect(mocks.composed).toHaveLength(2);
  });

  it('replaces an earlier order that is not open any more, not only the open one', async () => {
    mocks.orders = [earlier({ expiresAt: '2026-11-19T00:00:00.000Z' })];
    mocks.open = undefined;
    await start();
    expect(mocks.expireSession).toHaveBeenCalledWith('cs_old');
  });

  it('ends an earlier order on the same code before starting, in its own transaction', async () => {
    mocks.orders = [earlier({ couponCode: 'SPRING-20' })];
    await start();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.expireWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'old' }),
    );
    expect(mocks.composed).toHaveLength(1);
  });

  it('leaves the earlier session and reservation alone when the new code is refused', async () => {
    mocks.orders = [earlier({ couponCode: 'OTHER' })];
    mocks.db.coupon = undefined;
    await expect(start('B')).rejects.toEqual(
      refused('This code is not valid for this course'),
    );
    expect(mocks.expireSession).not.toHaveBeenCalled();
    expect(mocks.startOrder).not.toHaveBeenCalled();
  });

  it('answers "already enrolled" and replaces nothing when the old session turns out paid', async () => {
    mocks.orders = [earlier()];
    mocks.expireSession.mockRejectedValue(new Error('not open'));
    mocks.retrieveSession.mockResolvedValue({ status: 'complete' });
    await expect(start()).rejects.toEqual(
      refused('You are already enrolled in this course'),
    );
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('treats an already expired session as expired', async () => {
    mocks.orders = [earlier()];
    mocks.expireSession.mockRejectedValue(new Error('already expired'));
    mocks.retrieveSession.mockResolvedValue({ status: 'expired' });
    await start();
    expect(mocks.startOrder).toHaveBeenCalled();
  });

  it('changes nothing and is retryable when expiring fails for another reason', async () => {
    mocks.orders = [earlier()];
    mocks.expireSession.mockRejectedValue(new Error('network'));
    mocks.retrieveSession.mockResolvedValue({ status: 'open' });
    await expect(start()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('refuses retryably an order with no session that may be mid-creation', async () => {
    mocks.orders = [earlier({ checkoutSessionId: undefined })];
    await expect(start()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.expireSession).not.toHaveBeenCalled();
  });

  it('expires the order, releasing the claim, when Stripe fails', async () => {
    mocks.create.mockRejectedValue(new Error('stripe down'));
    await expect(start()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(mocks.expireOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'new' }),
    );
  });

  it.each([
    ['disabled', { enabled: false }, 'This code has been turned off'],
    [
      'expired',
      { expiresAt: '2020-01-01T00:00:00.000Z' },
      'This code has expired',
    ],
    [
      'below the minimum',
      { type: 'fixed', value: 4880, currency: 'usd' },
      'This code leaves a price too low to pay for',
    ],
  ])(
    'refuses a %s code with its message and starts nothing',
    async (_n, over, message) => {
      mocks.db.coupon = { ...coupon, ...over };
      await expect(start()).rejects.toEqual(refused(message));
      expect(mocks.startOrder).not.toHaveBeenCalled();
    },
  );

  it('refuses any code on a free course and a student already enrolled', async () => {
    mocks.db.course = { ...course, priceAmount: 0 };
    await expect(start()).rejects.toEqual(
      refused('This code is not valid for this course'),
    );
    mocks.db.course = course;
    mocks.db.enrolment = { status: 'active' };
    await expect(start()).rejects.toEqual(
      refused('You are already enrolled in this course'),
    );
  });

  it('reclaims expired reservations once for a used up code, then claims', async () => {
    mocks.db.coupon = { ...coupon, maxRedemptions: 1, redeemedCount: 1 };
    mocks.reclaim.mockImplementation(async () => {
      mocks.db.coupon = { ...coupon, maxRedemptions: 1, redeemedCount: 0 };
      return 1;
    });
    expect(await start()).toEqual({ checkoutUrl: 'https://pay/cs_new' });
    expect(mocks.reclaim).toHaveBeenCalledTimes(1);
  });

  it('refuses a code that is still used up after reclaiming', async () => {
    mocks.db.coupon = { ...coupon, maxRedemptions: 1, redeemedCount: 1 };
    await expect(start()).rejects.toEqual(
      refused('This code has been used the maximum number of times'),
    );
    expect(mocks.reclaim).toHaveBeenCalledTimes(1);
  });

  it('answers a cancelled claim with the matching refusal', async () => {
    mocks.startOrder.mockImplementationOnce(async () => {
      mocks.db.coupon = { ...coupon, enabled: false };
      throw new CheckoutStartCancelledError();
    });
    await expect(start()).rejects.toEqual(
      refused('This code has been turned off'),
    );
  });

  it('retries a conflict, then surfaces CONFLICT', async () => {
    mocks.startOrder.mockRejectedValueOnce(new CheckoutStartCancelledError());
    expect(await start()).toEqual({ checkoutUrl: 'https://pay/cs_new' });
    expect(mocks.startOrder).toHaveBeenCalledTimes(2);

    mocks.startOrder.mockReset();
    mocks.startOrder.mockRejectedValue(new CheckoutStartCancelledError());
    await expect(start()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.startOrder).toHaveBeenCalledTimes(3);
  });

  it('hands the reclaim a check that keeps a session that is paid or unknown', async () => {
    mocks.db.coupon = { ...coupon, maxRedemptions: 1, redeemedCount: 1 };
    await start().catch(() => undefined);
    const { canRelease } = mocks.reclaim.mock.calls[0]?.[0];
    const withSession = { orderId: 'x', checkoutSessionId: 'cs_x' };

    expect(await canRelease({ orderId: 'x' })).toBe(true);
    expect(await canRelease(withSession)).toBe(true);
    expect(mocks.expireSession).toHaveBeenCalledWith('cs_x');

    mocks.expireSession.mockRejectedValue(new Error('not open'));
    mocks.retrieveSession.mockResolvedValue({ status: 'complete' });
    expect(await canRelease(withSession)).toBe(false);
    mocks.retrieveSession.mockResolvedValue({ status: 'expired' });
    expect(await canRelease(withSession)).toBe(true);
    mocks.retrieveSession.mockRejectedValue(new Error('network'));
    expect(await canRelease(withSession)).toBe(false);
  });

  it('says payments are unavailable when the connection is not active', async () => {
    const { PaymentsUnavailableError } = await import('@discava/core-table');
    mocks.startOrder.mockRejectedValue(new PaymentsUnavailableError());
    await expect(start()).rejects.toEqual(
      refused('Payments are unavailable right now'),
    );
  });
});

describe('payment.checkout without a code after one with a code', () => {
  const plain = () => caller.checkout({ courseId: 'c1' });

  it('replaces the open coupon checkout instead of reusing it', async () => {
    mocks.orders = [earlier({ couponCode: 'SPRING-20' })];
    mocks.open = mocks.orders[0];
    expect(await plain()).toEqual({ checkoutUrl: 'https://pay/cs_new' });

    expect(mocks.expireSession).toHaveBeenCalledWith('cs_old');
    expect(mocks.calls).toEqual(['expireSession', 'startOrder']);
    const args = mocks.startOrder.mock.calls[0]?.[0];
    expect(args.discount).toBeUndefined();
    expect(mocks.expireWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'old', couponCode: 'SPRING-20' }),
    );
    expect(mocks.claim).not.toHaveBeenCalled();
    // The session is for the list price, not the old discounted one.
    expect(
      mocks.create.mock.calls[0]?.[0].line_items[0].price_data,
    ).toMatchObject({ unit_amount: created.amount });
  });

  it('still reuses an open checkout that has no code', async () => {
    mocks.orders = [earlier()];
    mocks.open = mocks.orders[0];
    expect(await plain()).toEqual({ checkoutUrl: 'https://pay/cs_old' });
    expect(mocks.startOrder).not.toHaveBeenCalled();
  });

  it('answers "already enrolled" and replaces nothing when the old session turns out paid', async () => {
    mocks.orders = [earlier({ couponCode: 'SPRING-20' })];
    mocks.open = mocks.orders[0];
    mocks.expireSession.mockRejectedValue(new Error('not open'));
    mocks.retrieveSession.mockResolvedValue({ status: 'complete' });
    await expect(plain()).rejects.toEqual(
      refused('You are already enrolled in this course'),
    );
    expect(mocks.startOrder).not.toHaveBeenCalled();
  });

  it('retries a conflict, then surfaces CONFLICT', async () => {
    mocks.orders = [earlier({ couponCode: 'SPRING-20' })];
    mocks.open = mocks.orders[0];
    mocks.startOrder.mockReset();
    mocks.startOrder.mockRejectedValue(new CheckoutStartCancelledError());
    await expect(plain()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.startOrder).toHaveBeenCalledTimes(3);
  });
});

describe('payment.checkout with a code that makes the course free', () => {
  const freeCoupon = { ...coupon, code: 'FREE', type: 'percent', value: 100 };
  beforeEach(() => {
    mocks.db = { course, coupon: freeCoupon };
  });

  it('enrols directly without calling Stripe, claiming the code as redeemed', async () => {
    expect(await start('free')).toEqual({ enrolled: true });
    expect(mocks.startOrder).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.expireSession).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
    expect(mocks.startFree.mock.calls[0]?.[0]).toMatchObject({
      userId: 'student-1',
      discount: {
        discountAmount: 4900,
        couponCode: 'FREE',
        couponType: 'percent',
        couponValue: 100,
      },
    });
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'redeemed', orderId: 'new' }),
    );
    expect(mocks.composed).toHaveLength(1);
  });

  it('expires a pending paid checkout first, then ends its order in the same transaction', async () => {
    mocks.orders = [earlier({ couponCode: 'SPRING-20' })];
    mocks.open = mocks.orders[0];
    await start('free');
    expect(mocks.calls).toEqual(['expireSession', 'startFreeOrder']);
    expect(mocks.expireSession).toHaveBeenCalledWith('cs_old');
    expect(mocks.expireWrites).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: 'old' }),
    );
    expect(mocks.composed).toHaveLength(2);
  });

  it('enrols nobody when the old session turns out paid', async () => {
    mocks.orders = [earlier()];
    mocks.expireSession.mockRejectedValue(new Error('already complete'));
    mocks.retrieveSession.mockResolvedValue({ status: 'complete' });
    await expect(start('free')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'You are already enrolled in this course',
    });
    expect(mocks.startFree).not.toHaveBeenCalled();
  });

  it('answers a repeat with the same result and writes nothing', async () => {
    mocks.db.couponRedemption = { status: 'redeemed', orderId: 'o-free' };
    mocks.db.enrolment = { status: 'active', orderId: 'o-free' };
    expect(await start('free')).toEqual({ enrolled: true });
    expect(mocks.startFree).not.toHaveBeenCalled();
  });

  it('answers a conflicting concurrent call by reading again, then returns the enrolment', async () => {
    mocks.startFree.mockImplementationOnce(async () => {
      mocks.db.couponRedemption = { status: 'redeemed', orderId: 'o-free' };
      mocks.db.enrolment = { status: 'active', orderId: 'o-free' };
      throw new CheckoutStartCancelledError();
    });
    expect(await start('free')).toEqual({ enrolled: true });
    expect(mocks.startFree).toHaveBeenCalledTimes(1);
  });

  it('surfaces CONFLICT after three cancelled starts', async () => {
    mocks.startFree.mockRejectedValue(new CheckoutStartCancelledError());
    await expect(start('free')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.startFree).toHaveBeenCalledTimes(3);
  });

  it('is refused when the code is used up', async () => {
    mocks.db.coupon = { ...freeCoupon, maxRedemptions: 1, redeemedCount: 1 };
    await expect(start('free')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This code has been used the maximum number of times',
    });
    expect(mocks.startFree).not.toHaveBeenCalled();
  });

  it('says payments are unavailable when the connection is not active', async () => {
    mocks.startFree.mockRejectedValue(new PaymentsUnavailableError());
    await expect(start('free')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Payments are unavailable right now',
    });
  });

  it('lets a course archived during the call surface as not found', async () => {
    mocks.startFree.mockRejectedValue(new NotFoundError());
    await expect(start('free')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never treats a total below the minimum as free', async () => {
    mocks.db.coupon = { ...coupon, code: 'ALMOST', type: 'percent', value: 99 };
    await expect(start('almost')).rejects.toMatchObject({
      message: 'This code leaves a price too low to pay for',
    });
    expect(mocks.startFree).not.toHaveBeenCalled();
  });
});
