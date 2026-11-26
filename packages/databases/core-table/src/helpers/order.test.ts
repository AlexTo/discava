/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { createCoreTableService } from '../service.js';
import {
  claimCouponWrites,
  reclaimExpiredReservations,
} from './coupon-redemption.js';
import {
  attachCheckoutSession,
  CheckoutStartCancelledError,
  EnrolmentPaidForError,
  expireOrder,
  expireOrderWrites,
  findOpenOrder,
  markRefundFailed,
  markRefundRequested,
  type OrderConnection,
  type OrderCourse,
  type OrderRecord,
  PaymentsUnavailableError,
  REFUND_PROGRESS_LIMIT_PERCENT,
  REFUND_WINDOW_DAYS,
  readRefundedBefore,
  readRefundLimits,
  refundEligibility,
  refundOrder,
  refundUndeliverable,
  restoreFreeEnrolment,
  reverseRefund,
  settleOrderPaid,
  startFreeOrder,
  startOrder,
  unenrolFromCourse,
} from './order.js';
import { createFakeCoreTable } from './payment-fake.test.js';

const NOW = '2026-11-19T00:00:00.000Z';
const LATER = '2026-11-19T00:10:00.000Z';
const EARLIER = '2026-11-18T00:00:00.000Z';

const course: OrderCourse = {
  courseId: 'course-1',
  title: 'Intro',
  status: 'published',
  priceAmount: 1999,
  priceCurrency: 'USD',
};
const connection: OrderConnection & Record<string, unknown> = {
  status: 'active',
  accountId: 'acct_1',
  mode: 'test',
  revision: 1,
};

const setup = () => {
  const fake = createFakeCoreTable();
  fake.put('course', { ...course });
  fake.put('paymentConnection', { ...connection });
  const getConnection = async () =>
    structuredClone(fake.rows('paymentConnection')[0]) as
      | OrderConnection
      | undefined;
  const start = (now = NOW, userId = 'user-1') =>
    startOrder({
      coreTable: fake.coreTable,
      course,
      userId,
      now,
      getConnection,
    });
  return { fake, getConnection, start };
};

const order = (over: Partial<OrderRecord> = {}): OrderRecord => ({
  orderId: 'order-1',
  userId: 'user-1',
  courseId: 'course-1',
  accountId: 'acct_1',
  mode: 'test',
  courseTitle: 'Intro',
  listAmount: 1999,
  amount: 1999,
  currency: 'USD',
  status: 'pending',
  expiresAt: '2026-11-19T01:00:00.000Z',
  ...over,
});

describe('startOrder', () => {
  it('creates a pending order from the course and the connection', async () => {
    const { fake, start } = setup();
    const created = await start();
    expect(created).toMatchObject({
      status: 'pending',
      listAmount: 1999,
      amount: 1999,
      currency: 'USD',
      courseTitle: 'Intro',
      accountId: 'acct_1',
      mode: 'test',
      expiresAt: '2026-11-19T01:00:00.000Z',
    });
    expect(fake.rows('order')).toHaveLength(1);
  });

  it('records the live mode of a live connection', async () => {
    const { fake, start } = setup();
    fake.rows('paymentConnection')[0].mode = 'live';
    expect(await start()).toMatchObject({ mode: 'live' });
  });

  it('refuses a free course and an unpublished one, writing nothing', async () => {
    const { fake, getConnection } = setup();
    for (const bad of [
      { ...course, priceAmount: 0 },
      { ...course, status: 'draft' },
    ]) {
      await expect(
        startOrder({
          coreTable: fake.coreTable,
          course: bad,
          userId: 'u',
          now: NOW,
          getConnection,
        }),
      ).rejects.toThrow();
    }
    expect(fake.rows('order')).toEqual([]);
  });

  it.each(['changing', 'disconnected'])(
    'refuses with payments-unavailable while the connection is %s',
    async (status) => {
      const { fake, start } = setup();
      fake.put('paymentConnection', { ...connection, status });
      await expect(start()).rejects.toBeInstanceOf(PaymentsUnavailableError);
      expect(fake.rows('order')).toEqual([]);
    },
  );

  it('refuses when there is no connection record', async () => {
    const { fake } = setup();
    await expect(
      startOrder({
        coreTable: fake.coreTable,
        course,
        userId: 'u',
        now: NOW,
        getConnection: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(PaymentsUnavailableError);
    expect(fake.rows('order')).toEqual([]);
  });

  it('raises the record expiry and never lowers it', async () => {
    const { fake, start } = setup();
    await start(NOW);
    expect(fake.rows('paymentConnection')[0]?.latestCheckoutExpiresAt).toBe(
      '2026-11-19T01:00:00.000Z',
    );
    await start('2026-11-18T00:00:00.000Z');
    expect(fake.rows('paymentConnection')[0]?.latestCheckoutExpiresAt).toBe(
      '2026-11-19T01:00:00.000Z',
    );
    await start('2026-11-19T02:00:00.000Z');
    expect(fake.rows('paymentConnection')[0]?.latestCheckoutExpiresAt).toBe(
      '2026-11-19T03:00:00.000Z',
    );
  });

  it('keeps the larger value when two starts run at once', async () => {
    const { fake, start } = setup();
    await Promise.all([
      start(NOW, 'a'),
      start('2026-11-19T00:30:00.000Z', 'b'),
    ]);
    expect(fake.rows('order')).toHaveLength(2);
    expect(fake.rows('paymentConnection')[0]?.latestCheckoutExpiresAt).toBe(
      '2026-11-19T01:30:00.000Z',
    );
  });

  it('does not touch the record revision', async () => {
    const { fake, start } = setup();
    await start();
    expect(fake.rows('paymentConnection')[0]?.revision).toBe(1);
  });

  it('honours a shorter life for local development', async () => {
    const { fake, getConnection } = setup();
    const created = await startOrder({
      coreTable: fake.coreTable,
      course,
      userId: 'u',
      now: NOW,
      getConnection,
      ttlSeconds: 30,
    });
    expect(created.expiresAt).toBe('2026-11-19T00:00:30.000Z');
  });

  it('throws after three attempts that lose to contention', async () => {
    const { fake, getConnection } = setup();
    let bump = 0;
    fake.hooks.beforeTransaction = () => {
      bump++;
      fake.put('paymentConnection', {
        ...connection,
        latestCheckoutExpiresAt: `2027-01-0${bump}T00:00:00.000Z`,
      });
    };
    await expect(
      startOrder({
        coreTable: fake.coreTable,
        course,
        userId: 'u',
        now: NOW,
        getConnection,
      }),
    ).rejects.toThrow();
    expect(fake.log.transactions).toBe(3);
    expect(fake.rows('order')).toEqual([]);
  });
});

describe('attachCheckoutSession and findOpenOrder', () => {
  const find = (fake: ReturnType<typeof setup>['fake'], userId = 'user-1') =>
    findOpenOrder({
      coreTable: fake.coreTable,
      userId,
      courseId: 'course-1',
      now: NOW,
    });

  it('patches a pending order only', async () => {
    const { fake } = setup();
    fake.put('order', order());
    fake.put('order', order({ orderId: 'order-2', status: 'paid' }));
    expect(
      await attachCheckoutSession(fake.coreTable, order(), {
        sessionId: 'cs_1',
        url: 'https://pay',
      }),
    ).toBe(true);
    expect(
      await attachCheckoutSession(
        fake.coreTable,
        order({ orderId: 'order-2' }),
        {
          sessionId: 'cs_2',
          url: 'https://pay',
        },
      ),
    ).toBe(false);
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      checkoutSessionId: 'cs_1',
      checkoutUrl: 'https://pay',
    });
    expect(fake.row('order', { orderId: 'order-2' })).not.toHaveProperty(
      'checkoutSessionId',
    );
  });

  it('finds the open one', async () => {
    const { fake } = setup();
    fake.put('order', order({ checkoutSessionId: 'cs_1' }));
    expect((await find(fake))?.orderId).toBe('order-1');
  });

  it('does not find one with no session, an expired one, one ending within 5 minutes, a paid one or another student’s', async () => {
    const { fake } = setup();
    fake.put('order', order({ orderId: 'a' }));
    fake.put(
      'order',
      order({
        orderId: 'b',
        checkoutSessionId: 's',
        expiresAt: '2026-11-18T23:00:00.000Z',
      }),
    );
    fake.put(
      'order',
      order({
        orderId: 'c',
        checkoutSessionId: 's',
        expiresAt: '2026-11-19T00:04:59.000Z',
      }),
    );
    fake.put(
      'order',
      order({ orderId: 'd', checkoutSessionId: 's', status: 'paid' }),
    );
    fake.put(
      'order',
      order({ orderId: 'e', checkoutSessionId: 's', userId: 'other' }),
    );
    expect(await find(fake)).toBeUndefined();
  });
});

describe('settleOrderPaid', () => {
  const settle = (fake: ReturnType<typeof setup>['fake'], id = 'order-1') =>
    settleOrderPaid({
      coreTable: fake.coreTable,
      order: { orderId: id },
      paymentIntentId: 'pi_1',
      now: LATER,
    });

  it('enrols a new student with the order', async () => {
    const { fake } = setup();
    fake.put('order', order());
    expect(await settle(fake)).toEqual({ result: 'fulfilled' });
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      status: 'paid',
      paidAt: LATER,
      paymentIntentId: 'pi_1',
    });
    expect(
      fake.row('enrolment', { courseId: 'course-1', userId: 'user-1' }),
    ).toMatchObject({ orderId: 'order-1', courseId: 'course-1' });
  });

  it.each([
    ['with completedAt', { completedAt: 'x' }, 'completed'],
    ['without it', {}, 'active'],
  ])(
    'restores a dropped student %s, keeping progress',
    async (_n, extra, status) => {
      const { fake } = setup();
      fake.put('order', order({ orderId: 'order-2' }));
      fake.put('enrolment', {
        courseId: 'course-1',
        userId: 'user-1',
        status: 'dropped',
        progressPercent: 40,
        orderId: 'order-1',
        ...extra,
      });
      fake.put('order', order({ status: 'refunded' }));
      expect(await settle(fake, 'order-2')).toEqual({ result: 'fulfilled' });
      expect(
        fake.row('enrolment', { courseId: 'course-1', userId: 'user-1' }),
      ).toMatchObject({ status, progressPercent: 40, orderId: 'order-2' });
    },
  );

  it.each(['active', 'completed'])(
    'reports a duplicate for an %s enrolment and writes nothing',
    async (status) => {
      const { fake } = setup();
      fake.put('order', order());
      fake.put('enrolment', { courseId: 'course-1', userId: 'user-1', status });
      expect(await settle(fake)).toEqual({
        result: 'undeliverable',
        reason: 'duplicate',
      });
      expect(fake.row('order', { orderId: 'order-1' })?.status).toBe('pending');
    },
  );

  it.each(['draft', 'archived', undefined])(
    'reports a course that is %s as unavailable',
    async (status) => {
      const { fake } = setup();
      fake.put('order', order());
      if (status) fake.put('course', { ...course, status });
      else fake.rows('course').length = 0;
      if (!status) {
        const other = createFakeCoreTable();
        other.put('order', order());
        expect(await settle(other)).toEqual({
          result: 'undeliverable',
          reason: 'unavailable',
        });
        return;
      }
      expect(await settle(fake)).toEqual({
        result: 'undeliverable',
        reason: 'unavailable',
      });
      expect(fake.rows('enrolment')).toEqual([]);
    },
  );

  it('settles the same order twice, and twice at once, into one enrolment', async () => {
    const { fake } = setup();
    fake.put('order', order());
    const results = await Promise.all([
      settle(fake),
      settle(fake),
      settle(fake),
    ]);
    expect(results.filter((r) => r.result === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.result === 'already-settled')).toHaveLength(
      2,
    );
    expect(fake.rows('enrolment')).toHaveLength(1);
    expect(await settle(fake)).toEqual({ result: 'already-settled' });
  });

  it('never marks the order paid when the enrolment write fails', async () => {
    const { fake } = setup();
    fake.put('order', order());
    // An enrolment appears between the read and the write.
    fake.hooks.beforeTransaction = () => {
      fake.hooks.beforeTransaction = undefined;
      fake.put('enrolment', {
        courseId: 'course-1',
        userId: 'user-1',
        status: 'active',
      });
    };
    expect(await settle(fake)).toEqual({
      result: 'undeliverable',
      reason: 'duplicate',
    });
    expect(fake.row('order', { orderId: 'order-1' })?.status).toBe('pending');
  });

  it('throws after three cancelled attempts', async () => {
    const { fake } = setup();
    fake.put('order', order());
    // A competing writer keeps changing the course between the read and the
    // write, so the transaction is cancelled every time.
    fake.hooks.beforeTransaction = () => {
      fake.put('enrolment', {
        courseId: 'course-1',
        userId: 'user-1',
        status: 'dropped',
      });
      fake.put('course', { ...course, status: 'archived' });
    };
    const reads = fake.coreTable.entities.course;
    const realGet = reads.get;
    let count = 0;
    reads.get = ((key: { courseId: string }) => {
      count++;
      fake.put('course', { ...course, status: 'published' });
      return realGet(key);
    }) as typeof reads.get;
    await expect(settle(fake)).rejects.toThrow();
    expect(count).toBe(3);
    expect(fake.row('order', { orderId: 'order-1' })?.status).toBe('pending');
  });
});

describe('expireOrder and refundUndeliverable', () => {
  it('expires a pending order and leaves any other alone', async () => {
    const { fake } = setup();
    fake.put('order', order());
    fake.put('order', order({ orderId: 'p', status: 'paid' }));
    await expireOrder(fake.coreTable, { orderId: 'order-1' });
    await expireOrder(fake.coreTable, { orderId: 'p' });
    expect(fake.row('order', { orderId: 'order-1' })?.status).toBe('expired');
    expect(fake.row('order', { orderId: 'p' })?.status).toBe('paid');
  });

  it.each(['duplicate', 'unavailable', 'mismatch'] as const)(
    'refunds an undeliverable order for %s in full',
    async (reason) => {
      const { fake } = setup();
      fake.put('order', order());
      await refundUndeliverable(
        fake.coreTable,
        { orderId: 'order-1' },
        reason,
        LATER,
      );
      expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
        status: 'refunded',
        refundReason: reason,
        refundedAt: LATER,
        refundedAmount: 1999,
        paidAt: LATER,
      });
    },
  );

  it('keeps an existing paidAt and does nothing the second time', async () => {
    const { fake } = setup();
    fake.put('order', order({ paidAt: NOW }));
    await refundUndeliverable(
      fake.coreTable,
      { orderId: 'order-1' },
      'duplicate',
      LATER,
    );
    await refundUndeliverable(
      fake.coreTable,
      { orderId: 'order-1' },
      'unavailable',
      'later',
    );
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      paidAt: NOW,
      refundReason: 'duplicate',
      refundedAt: LATER,
    });
  });
});

describe('refundOrder', () => {
  const paid = (over: Partial<OrderRecord> = {}) =>
    order({ status: 'paid', paidAt: NOW, paymentIntentId: 'pi', ...over });
  const refund = (
    fake: ReturnType<typeof setup>['fake'],
    total: number,
    id = 'order-1',
  ) =>
    refundOrder({
      coreTable: fake.coreTable,
      order: { orderId: id },
      refundedTotal: total,
      now: LATER,
    });

  it('refunds in full: the order and the enrolment end together', async () => {
    const { fake } = setup();
    fake.put('order', paid());
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'completed',
      completedAt: 'x',
      orderId: 'order-1',
    });
    await refund(fake, 1999);
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      status: 'refunded',
      refundReason: 'requested',
      refundedAt: LATER,
      refundedAmount: 1999,
    });
    expect(
      fake.row('enrolment', { courseId: 'course-1', userId: 'user-1' }),
    ).toMatchObject({
      status: 'dropped',
      completedAt: 'x',
      orderId: 'order-1',
    });
  });

  it('leaves a completed student’s certificate valid, with no event', async () => {
    const { fake } = setup();
    fake.put('order', paid());
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'completed',
      completedAt: 'x',
      orderId: 'order-1',
    });
    const stored = {
      userId: 'user-1',
      courseId: 'course-1',
      certificateId: '0123456789ABCDEF',
    };
    fake.put('certificate', stored);
    await refund(fake, 1999);
    expect(fake.row('certificate', stored)).toEqual(stored);
    expect(fake.rows('certificateEvent')).toEqual([]);
  });

  it('raises refundedAmount for a partial refund and never lowers it', async () => {
    const { fake } = setup();
    fake.put('order', paid());
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'active',
      orderId: 'order-1',
    });
    await refund(fake, 500);
    await refund(fake, 300);
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      status: 'paid',
      refundedAmount: 500,
    });
    expect(
      fake.row('enrolment', { courseId: 'course-1', userId: 'user-1' })?.status,
    ).toBe('active');
    await refund(fake, 700);
    expect(fake.row('order', { orderId: 'order-1' })?.refundedAmount).toBe(700);
  });

  it('is a no-op the second time, and for a pending order', async () => {
    const { fake } = setup();
    fake.put('order', paid());
    fake.put('order', order({ orderId: 'pending' }));
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'active',
      orderId: 'order-1',
    });
    await refund(fake, 1999);
    await refund(fake, 1999);
    await refund(fake, 1999, 'pending');
    expect(fake.row('order', { orderId: 'order-1' })?.refundedAt).toBe(LATER);
    expect(fake.row('order', { orderId: 'pending' })?.status).toBe('pending');
  });

  it('leaves a newer enrolment alone when an old order is refunded again', async () => {
    const { fake } = setup();
    fake.put(
      'order',
      order({
        status: 'refunded',
        refundReason: 'requested',
        refundedAt: NOW,
        refundedAmount: 1999,
        paidAt: NOW,
      }),
    );
    fake.put('order', paid({ orderId: 'order-2' }));
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'active',
      orderId: 'order-2',
    });
    await refund(fake, 1999, 'order-1');
    expect(
      fake.row('enrolment', { courseId: 'course-1', userId: 'user-1' })?.status,
    ).toBe('active');
  });
});

describe('restoreFreeEnrolment', () => {
  const free = { ...course, priceAmount: 0 };
  const restore = (fake: ReturnType<typeof setup>['fake']) =>
    restoreFreeEnrolment({
      coreTable: fake.coreTable,
      courseId: 'course-1',
      userId: 'user-1',
    });
  const dropped = (extra = {}) => ({
    courseId: 'course-1',
    userId: 'user-1',
    status: 'dropped',
    progressPercent: 60,
    orderId: 'order-1',
    ...extra,
  });

  it.each([
    [{ completedAt: 'x' }, 'completed'],
    [{}, 'active'],
  ])(
    'restores a dropped enrolment (%j) to %s without its order',
    async (extra, status) => {
      const { fake } = setup();
      fake.put('course', free);
      fake.put('enrolment', dropped(extra));
      expect(await restore(fake)).toBe('restored');
      const row = fake.row('enrolment', {
        courseId: 'course-1',
        userId: 'user-1',
      });
      expect(row).toMatchObject({ status, progressPercent: 60 });
      expect(row).not.toHaveProperty('orderId');
      expect(fake.rows('order')).toEqual([]);
    },
  );

  it.each([
    ['priced', course],
    ['draft', { ...free, status: 'draft' }],
    ['archived', { ...free, status: 'archived' }],
  ])('refuses a %s course and writes nothing', async (_n, c) => {
    const { fake } = setup();
    fake.put('course', c);
    fake.put('enrolment', dropped());
    expect(await restore(fake)).toBe('course-unavailable');
    expect(
      fake.row('enrolment', { courseId: 'course-1', userId: 'user-1' })?.status,
    ).toBe('dropped');
  });

  it.each(['active', 'completed'])(
    'reports %s as not dropped',
    async (status) => {
      const { fake } = setup();
      fake.put('course', free);
      fake.put('enrolment', dropped({ status }));
      expect(await restore(fake)).toBe('not-dropped');
    },
  );

  it('gives one restored and one not-dropped for two calls at once', async () => {
    const { fake } = setup();
    fake.put('course', free);
    fake.put('enrolment', dropped());
    const results = await Promise.all([restore(fake), restore(fake)]);
    expect(results.sort()).toEqual(['not-dropped', 'restored']);
  });

  it('racing a paid settlement ends with one winner', async () => {
    const { fake } = setup();
    fake.put('course', free);
    fake.put('enrolment', dropped());
    fake.put('order', order({ orderId: 'order-2' }));
    const [restored, settled] = await Promise.all([
      restore(fake),
      settleOrderPaid({
        coreTable: fake.coreTable,
        order: { orderId: 'order-2' },
        paymentIntentId: 'pi',
        now: LATER,
      }),
    ]);
    const enrolment = fake.row('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
    });
    expect(enrolment?.status).not.toBe('dropped');
    const restoredWon = restored === 'restored';
    const settledWon = settled.result === 'fulfilled';
    expect(restoredWon).not.toBe(settledWon);
    if (restoredWon) expect(enrolment).not.toHaveProperty('orderId');
    else expect(enrolment?.orderId).toBe('order-2');
  });
});

describe('refundEligibility', () => {
  const PAID = '2026-11-01T00:00:00.000Z';
  const UNTIL = '2026-11-15T00:00:00.000Z';
  const paid = (over: Partial<OrderRecord> = {}) =>
    order({ status: 'paid', paidAt: PAID, paymentIntentId: 'pi', ...over });
  const enrolment = { orderId: 'order-1', status: 'active' };
  const active = { status: 'active', accountId: 'acct_1' };
  const decide = (
    over: {
      order?: Partial<OrderRecord>;
      enrolment?: { orderId?: string; status: string };
      connection?: { status: string; accountId?: string };
      progressPercent?: number;
      refundedBefore?: boolean;
      now?: string;
    } = {},
  ) =>
    refundEligibility({
      order: paid(over.order),
      enrolment: over.enrolment ?? enrolment,
      connection: over.connection ?? active,
      progressPercent: over.progressPercent ?? 0,
      refundedBefore: over.refundedBefore ?? false,
      now: over.now ?? '2026-11-05T00:00:00.000Z',
    });

  it('is never eligible for an order of nothing made by a free-making code', () => {
    expect(decide({ order: { amount: 0, couponCode: 'FREE' } })).toEqual({
      eligible: false,
      reason: 'not-paid',
    });
  });

  it('has a 14-day window', () => {
    expect(REFUND_WINDOW_DAYS).toBe(14);
  });

  it('is eligible inside the window, and at exactly the limit', () => {
    expect(decide()).toEqual({ eligible: true, refundableUntil: UNTIL });
    expect(decide({ now: UNTIL })).toEqual({
      eligible: true,
      refundableUntil: UNTIL,
    });
  });

  it('is not eligible one millisecond after the limit', () => {
    expect(decide({ now: '2026-11-15T00:00:00.001Z' })).toEqual({
      eligible: false,
      reason: 'window-ended',
    });
  });

  it.each([
    ['pending', { status: 'pending' as const }],
    ['refunded', { status: 'refunded' as const }],
    ['expired', { status: 'expired' as const }],
  ])('refuses a %s order as not-paid', (_, over) => {
    expect(decide({ order: over })).toEqual({
      eligible: false,
      reason: 'not-paid',
    });
  });

  it('refuses an order the enrolment does not rest on', () => {
    expect(
      decide({ enrolment: { orderId: 'order-2', status: 'active' } }),
    ).toEqual({ eligible: false, reason: 'not-current-order' });
    expect(decide({ enrolment: { status: 'active' } })).toEqual({
      eligible: false,
      reason: 'not-current-order',
    });
    expect(
      decide({ enrolment: { orderId: 'order-1', status: 'dropped' } }),
    ).toEqual({ eligible: false, reason: 'not-current-order' });
  });

  it('refuses an order from another account, or with payments not connected', () => {
    expect(
      decide({ connection: { status: 'active', accountId: 'acct_2' } }),
    ).toEqual({ eligible: false, reason: 'other-account' });
    expect(
      decide({ connection: { status: 'disconnected', accountId: 'acct_1' } }),
    ).toEqual({ eligible: false, reason: 'other-account' });
    expect(
      refundEligibility({
        order: paid(),
        enrolment,
        connection: undefined,
        progressPercent: 0,
        refundedBefore: false,
        now: PAID,
      }),
    ).toEqual({ eligible: false, reason: 'other-account' });
  });

  it('refuses a request already made', () => {
    expect(decide({ order: { refundRequestedAt: PAID } })).toEqual({
      eligible: false,
      reason: 'already-requested',
    });
  });

  it('refuses a completed enrolment', () => {
    expect(
      decide({ enrolment: { orderId: 'order-1', status: 'completed' } }),
    ).toEqual({ eligible: false, reason: 'completed' });
  });

  it('gives the first reason that applies', () => {
    expect(
      decide({
        order: { refundRequestedAt: PAID },
        enrolment: { orderId: 'order-1', status: 'completed' },
        now: '2027-01-01T00:00:00.000Z',
      }),
    ).toEqual({ eligible: false, reason: 'already-requested' });
    expect(
      decide({
        enrolment: { orderId: 'order-1', status: 'completed' },
        now: '2027-01-01T00:00:00.000Z',
      }),
    ).toEqual({ eligible: false, reason: 'completed' });
  });
});

describe('refundEligibility: limits', () => {
  const PAID = '2026-11-01T00:00:00.000Z';
  const decide = (
    over: {
      progressPercent?: number;
      refundedBefore?: boolean;
      status?: string;
      requested?: boolean;
      now?: string;
    } = {},
  ) =>
    refundEligibility({
      order: order({
        status: 'paid',
        paidAt: PAID,
        paymentIntentId: 'pi',
        ...(over.requested ? { refundRequestedAt: PAID } : {}),
      }),
      enrolment: { orderId: 'order-1', status: over.status ?? 'active' },
      connection: { status: 'active', accountId: 'acct_1' },
      progressPercent: over.progressPercent ?? 0,
      refundedBefore: over.refundedBefore ?? false,
      now: over.now ?? '2026-11-05T00:00:00.000Z',
    });

  it('has a limit of half the course', () => {
    expect(REFUND_PROGRESS_LIMIT_PERCENT).toBe(50);
  });

  it('is eligible at 49 percent and refused at 50', () => {
    expect(decide({ progressPercent: 49 })).toMatchObject({ eligible: true });
    expect(decide({ progressPercent: 50 })).toEqual({
      eligible: false,
      reason: 'progress-limit',
    });
    expect(decide({ progressPercent: 80 })).toEqual({
      eligible: false,
      reason: 'progress-limit',
    });
  });

  it('still reports a completed enrolment as completed', () => {
    expect(decide({ status: 'completed', progressPercent: 100 })).toEqual({
      eligible: false,
      reason: 'completed',
    });
  });

  it('refuses a course refunded before', () => {
    expect(decide({ refundedBefore: true })).toEqual({
      eligible: false,
      reason: 'refunded-before',
    });
  });

  it('gives each failing condition its own reason, in order', () => {
    const late = '2027-01-01T00:00:00.000Z';
    expect(
      decide({
        requested: true,
        status: 'completed',
        progressPercent: 100,
        refundedBefore: true,
        now: late,
      }),
    ).toEqual({ eligible: false, reason: 'already-requested' });
    expect(
      decide({
        status: 'completed',
        progressPercent: 100,
        refundedBefore: true,
        now: late,
      }),
    ).toEqual({ eligible: false, reason: 'completed' });
    expect(
      decide({ progressPercent: 60, refundedBefore: true, now: late }),
    ).toEqual({ eligible: false, reason: 'progress-limit' });
    expect(decide({ refundedBefore: true, now: late })).toEqual({
      eligible: false,
      reason: 'refunded-before',
    });
    expect(decide({ now: late })).toEqual({
      eligible: false,
      reason: 'window-ended',
    });
  });
});

describe('readRefundLimits', () => {
  type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
  const items = ['i1', 'i2', 'i3', 'i4'];
  const visible = { visibility: 'visible' as const };

  // The fake has no curriculum collection or completions: give it a
  // four-item course and the completions asked for.
  const setup = (completed: string[]) => {
    const fake = createFakeCoreTable();
    const base = fake.coreTable as unknown as CoreTable;
    const coreTable = {
      ...base,
      entities: new Proxy(base.entities, {
        get: (target, name: string) =>
          name === 'itemCompletion'
            ? {
                query: {
                  primary: () => ({
                    go: async () => ({
                      data: completed.map((contentItemId) => ({
                        contentItemId,
                      })),
                    }),
                  }),
                },
              }
            : (target as Record<string, unknown>)[name],
      }),
      collections: {
        curriculum: () => ({
          go: async () => ({
            data: {
              module: [{ ...visible, moduleId: 'm1' }],
              lesson: [{ ...visible, moduleId: 'm1', lessonId: 'l1' }],
              contentItem: items.map((contentItemId) => ({
                ...visible,
                moduleId: 'm1',
                lessonId: 'l1',
                contentItemId,
              })),
            },
          }),
        }),
      },
    } as unknown as CoreTable;
    return { fake, coreTable };
  };
  const args = (coreTable: CoreTable) => ({
    coreTable,
    userId: 'user-1',
    courseId: 'course-1',
  });
  const earlier = (over: Partial<OrderRecord> = {}) =>
    order({
      orderId: 'order-0',
      status: 'refunded',
      paidAt: NOW,
      refundedAt: LATER,
      refundReason: 'requested',
      refundRequestedAt: NOW,
      ...over,
    });

  it('computes the share from completions and the curriculum, not the stored figure', async () => {
    const { fake, coreTable } = setup(['i1', 'i2']);
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'active',
      progressPercent: 25,
    });
    expect(await readRefundLimits(args(coreTable))).toEqual({
      progressPercent: 50,
      refundedBefore: false,
    });
  });

  it('counts a refund made at the student request', async () => {
    const { fake, coreTable } = setup(['i1']);
    fake.put('order', earlier());
    expect(await readRefundLimits(args(coreTable))).toEqual({
      progressPercent: 25,
      refundedBefore: true,
    });
  });

  it.each([
    ['an operator', { refundRequestedAt: undefined }],
    ['a duplicate payment', { refundReason: 'duplicate' as const }],
    ['an unavailable course', { refundReason: 'unavailable' as const }],
    ['a mismatch', { refundReason: 'mismatch' as const }],
    ['a pending request', { status: 'paid' as const }],
  ])('does not count a refund by %s', async (_, over) => {
    const { fake, coreTable } = setup([]);
    const row = { ...earlier(over) } as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (row[key] === undefined) delete row[key];
    }
    fake.put('order', row);
    expect(await readRefundedBefore(args(coreTable))).toBe(false);
  });

  it('ignores the refunds of another student or course', async () => {
    const { fake, coreTable } = setup([]);
    fake.put('order', earlier({ userId: 'user-2' }));
    fake.put('order', earlier({ orderId: 'order-9', courseId: 'course-2' }));
    expect(await readRefundedBefore(args(coreTable))).toBe(false);
  });
});

describe('markRefundRequested', () => {
  const paid = (over: Partial<OrderRecord> = {}) =>
    order({ status: 'paid', paidAt: NOW, paymentIntentId: 'pi', ...over });
  const mark = (fake: ReturnType<typeof setup>['fake'], now = LATER) =>
    markRefundRequested({
      coreTable: fake.coreTable,
      order: { orderId: 'order-1' },
      now,
    });

  it('sets refundRequestedAt once and leaves the status alone', async () => {
    const { fake } = setup();
    fake.put('order', paid());
    await mark(fake);
    await mark(fake, '2026-11-20T00:00:00.000Z');
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      status: 'paid',
      refundRequestedAt: LATER,
    });
  });

  it.each([
    ['refunded', { status: 'refunded' as const, refundedAt: NOW }],
    ['pending', { status: 'pending' as const }],
  ])('is a no-op on a %s order', async (_, over) => {
    const { fake } = setup();
    fake.put('order', paid(over));
    await expect(mark(fake)).resolves.toBeUndefined();
    expect(
      fake.row('order', { orderId: 'order-1' })?.refundRequestedAt,
    ).toBeUndefined();
  });
});

describe('unenrolFromCourse', () => {
  const key = { courseId: 'course-1', userId: 'user-1' };
  const leave = (fake: ReturnType<typeof setup>['fake']) =>
    unenrolFromCourse({ coreTable: fake.coreTable, ...key, now: LATER });
  const enrolled = (extra = {}) => ({
    ...key,
    status: 'active',
    progressPercent: 40,
    ...extra,
  });

  it.each([
    [{ status: 'active' }],
    [{ status: 'completed', completedAt: NOW, progressPercent: 100 }],
  ])('drops an unpaid enrolment (%j), keeping its progress', async (extra) => {
    const { fake } = setup();
    fake.put('enrolment', enrolled(extra));
    expect(await leave(fake)).toBe(true);
    const row = fake.row('enrolment', key);
    expect(row).toMatchObject({ ...extra, status: 'dropped' });
    expect(row).not.toHaveProperty('orderId');
  });

  it('refuses an enrolment with an order and leaves it unchanged', async () => {
    const { fake } = setup();
    fake.put('enrolment', enrolled({ orderId: 'order-1' }));
    await expect(leave(fake)).rejects.toBeInstanceOf(EnrolmentPaidForError);
    expect(fake.row('enrolment', key)).toMatchObject({
      status: 'active',
      orderId: 'order-1',
    });
  });

  it('does nothing for a dropped or missing enrolment', async () => {
    const { fake } = setup();
    expect(await leave(fake)).toBe(false);
    fake.put('enrolment', enrolled({ status: 'dropped' }));
    expect(await leave(fake)).toBe(false);
    expect(fake.row('enrolment', key)?.status).toBe('dropped');
  });
});

// ---- Coupons: a discounted order, and the redemption that follows it. ----

describe('orders with a coupon', () => {
  const discount = {
    discountAmount: 500,
    couponCode: 'SPRING-20',
    couponType: 'fixed' as const,
    couponValue: 500,
  };
  const claimFor = (userId = 'user-1') => ({
    coupon: { courseId: 'course-1', code: 'SPRING-20' },
    userId,
    now: NOW,
  });
  const couponSetup = (count = 0, extra: Record<string, unknown> = {}) => {
    const s = setup();
    s.fake.put('coupon', {
      courseId: 'course-1',
      code: 'SPRING-20',
      type: 'fixed',
      value: 500,
      currency: 'USD',
      enabled: true,
      redeemedCount: count,
      ...extra,
    });
    const startWithCode = (userId = 'user-1') =>
      startOrder({
        coreTable: s.fake.coreTable,
        course,
        userId,
        now: NOW,
        getConnection: s.getConnection,
        discount,
        extraWrites: (entities, created) =>
          claimCouponWrites(entities, {
            ...claimFor(userId),
            orderId: created.orderId,
            status: 'reserved',
            reservedUntil: LATER,
          }),
      });
    return { ...s, startWithCode };
  };

  it('snapshots the discount and charges the difference, in one transaction with the claim', async () => {
    const { fake, startWithCode } = couponSetup();
    const created = await startWithCode();
    expect(created).toMatchObject({
      listAmount: 1999,
      amount: 1499,
      ...discount,
    });
    expect(fake.rows('order')).toHaveLength(1);
    expect(fake.rows('couponRedemption')).toHaveLength(1);
    expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
  });

  it('writes no discount fields for an order without a code', async () => {
    const { start } = setup();
    const created = await start();
    for (const field of Object.keys(discount)) {
      expect(created).not.toHaveProperty(field);
    }
  });

  it('refuses a discount that leaves nothing to charge or takes nothing off', async () => {
    const { fake, getConnection } = setup();
    for (const discountAmount of [0, 1999, 3000]) {
      await expect(
        startOrder({
          coreTable: fake.coreTable,
          course,
          userId: 'u',
          now: NOW,
          getConnection,
          discount: { ...discount, discountAmount },
        }),
      ).rejects.toThrow();
    }
    expect(fake.rows('order')).toEqual([]);
  });

  it('writes nothing when the claim is refused', async () => {
    const { fake, startWithCode } = couponSetup(1, { maxRedemptions: 1 });
    await expect(startWithCode()).rejects.toBeInstanceOf(
      CheckoutStartCancelledError,
    );
    expect(fake.rows('order')).toEqual([]);
    expect(fake.rows('couponRedemption')).toEqual([]);
  });

  it('writes nothing when the student is already enrolled or the course is not published', async () => {
    const { fake, startWithCode } = couponSetup();
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'active',
    });
    await expect(startWithCode()).rejects.toBeInstanceOf(
      CheckoutStartCancelledError,
    );
    fake.rows('enrolment')[0]!.status = 'dropped';
    await expect(startWithCode()).resolves.toMatchObject({ amount: 1499 });
    fake.rows('course')[0]!.status = 'draft';
    await expect(startWithCode('user-2')).rejects.toBeInstanceOf(
      CheckoutStartCancelledError,
    );
    expect(fake.rows('order')).toHaveLength(1);
  });

  it('moves an earlier order to expired and releases its code in the same transaction', async () => {
    const { fake, startWithCode, getConnection } = couponSetup();
    const first = await startWithCode();
    const second = await startOrder({
      coreTable: fake.coreTable,
      course,
      userId: 'user-1',
      now: NOW,
      getConnection,
      extraWrites: (entities) => expireOrderWrites(entities, first),
    });
    expect(fake.row('order', first)?.status).toBe('expired');
    expect(second.status).toBe('pending');
    expect(fake.rows('couponRedemption')).toEqual([]);
    expect(fake.rows('coupon')[0]?.redeemedCount).toBe(0);
  });

  describe('settling, expiring and refunding', () => {
    const started = async () => {
      const s = couponSetup();
      const created = await s.startWithCode();
      return { ...s, created };
    };

    it('paid confirms the redemption with the enrolment, even if the coupon was since disabled or expired', async () => {
      const { fake, created } = await started();
      Object.assign(fake.rows('coupon')[0]!, {
        enabled: false,
        expiresAt: EARLIER,
      });
      const result = await settleOrderPaid({
        coreTable: fake.coreTable,
        order: created,
        now: LATER,
      });
      expect(result).toEqual({ result: 'fulfilled' });
      expect(fake.rows('couponRedemption')[0]).toMatchObject({
        status: 'redeemed',
      });
      expect(fake.rows('couponRedemption')[0]).not.toHaveProperty(
        'reservedUntil',
      );
      expect(fake.rows('enrolment')).toHaveLength(1);
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
    });

    it('a replayed paid event changes nothing', async () => {
      const { fake, created } = await started();
      const args = { coreTable: fake.coreTable, order: created, now: LATER };
      await settleOrderPaid(args);
      const before = structuredClone([
        fake.rows('couponRedemption'),
        fake.rows('coupon'),
      ]);
      expect(await settleOrderPaid(args)).toEqual({
        result: 'already-settled',
      });
      expect([fake.rows('couponRedemption'), fake.rows('coupon')]).toEqual(
        before,
      );
    });

    it('expired releases the redemption and lowers the count, once', async () => {
      const { fake, created } = await started();
      await expireOrder(fake.coreTable, created);
      await expireOrder(fake.coreTable, created);
      expect(fake.row('order', created)?.status).toBe('expired');
      expect(fake.rows('couponRedemption')).toEqual([]);
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(0);
    });

    it('a paid event after the reservation was reclaimed is already settled and writes no redemption', async () => {
      const { fake, created } = await started();
      await reclaimExpiredReservations({
        coreTable: fake.coreTable,
        courseId: 'course-1',
        code: 'SPRING-20',
        now: '2026-11-19T03:00:00.000Z',
      });
      expect(
        await settleOrderPaid({
          coreTable: fake.coreTable,
          order: created,
          now: LATER,
        }),
      ).toEqual({ result: 'already-settled' });
      expect(fake.rows('couponRedemption')).toEqual([]);
      expect(fake.rows('enrolment')).toEqual([]);
    });

    it.each(['duplicate', 'unavailable', 'mismatch'] as const)(
      'an order refunded as %s releases',
      async (reason) => {
        const { fake, created } = await started();
        await refundUndeliverable(fake.coreTable, created, reason, LATER);
        expect(fake.row('order', created)?.status).toBe('refunded');
        expect(fake.rows('couponRedemption')).toEqual([]);
        expect(fake.rows('coupon')[0]?.redeemedCount).toBe(0);
      },
    );

    it('a full refund after delivery keeps the redemption', async () => {
      const { fake, created } = await started();
      await settleOrderPaid({
        coreTable: fake.coreTable,
        order: created,
        now: LATER,
      });
      await refundOrder({
        coreTable: fake.coreTable,
        order: created,
        refundedTotal: created.amount,
        now: LATER,
      });
      expect(fake.row('order', created)?.status).toBe('refunded');
      expect(fake.rows('couponRedemption')[0]).toMatchObject({
        status: 'redeemed',
      });
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
    });

    it('leaves an order without a code untouched by expiry', async () => {
      const { fake, start } = setup();
      const plain = await start();
      await expireOrder(fake.coreTable, plain);
      expect(fake.row('order', plain)?.status).toBe('expired');
      expect(fake.rows('couponRedemption')).toEqual([]);
    });
  });

  describe('reclaimExpiredReservations', () => {
    const reclaim = (fake: ReturnType<typeof setup>['fake'], now: string) =>
      reclaimExpiredReservations({
        coreTable: fake.coreTable,
        courseId: 'course-1',
        code: 'SPRING-20',
        now,
      });
    const PAST_RESERVATION = '2026-11-19T02:00:00.000Z';

    it('releases only reservations past reservedUntil, dropping the count once each', async () => {
      const { fake, startWithCode } = couponSetup();
      const old = await startWithCode('user-1');
      // user-2 reserved later, so it is not yet expired at the reclaim time.
      fake.rows('couponRedemption')[0]!.reservedUntil = EARLIER;
      const fresh = await startWithCode('user-2');
      expect(await reclaim(fake, NOW)).toBe(1);
      expect(fake.row('order', old)?.status).toBe('expired');
      expect(fake.row('order', fresh)?.status).toBe('pending');
      expect(fake.rows('couponRedemption')).toHaveLength(1);
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
    });

    it('keeps a reservation not yet expired', async () => {
      const { fake, startWithCode } = couponSetup();
      await startWithCode();
      expect(await reclaim(fake, NOW)).toBe(0);
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
    });

    it('releases each once when called twice or at the same time', async () => {
      const { fake, startWithCode } = couponSetup();
      await startWithCode();
      const results = await Promise.all([
        reclaim(fake, PAST_RESERVATION),
        reclaim(fake, PAST_RESERVATION),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await reclaim(fake, PAST_RESERVATION)).toBe(0);
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(0);
    });

    it('keeps a reservation whose session is still payable, so a late paid event settles it', async () => {
      const { fake, startWithCode } = couponSetup(0, { maxRedemptions: 1 });
      const created = await startWithCode();
      const canRelease = vi.fn(async () => false);
      expect(
        await reclaimExpiredReservations({
          coreTable: fake.coreTable,
          courseId: 'course-1',
          code: 'SPRING-20',
          now: PAST_RESERVATION,
          canRelease,
        }),
      ).toBe(0);
      expect(canRelease).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: created.orderId }),
      );
      expect(fake.row('order', created)?.status).toBe('pending');
      // The delayed checkout.session.completed now finds a pending order.
      expect(
        await settleOrderPaid({
          coreTable: fake.coreTable,
          order: created,
          now: LATER,
        }),
      ).toEqual({ result: 'fulfilled' });
      expect(fake.rows('couponRedemption')[0]).toMatchObject({
        status: 'redeemed',
      });
      expect(fake.rows('enrolment')).toHaveLength(1);
    });

    it('releases when the session is confirmed ended', async () => {
      const { fake, startWithCode } = couponSetup();
      await startWithCode();
      expect(
        await reclaimExpiredReservations({
          coreTable: fake.coreTable,
          courseId: 'course-1',
          code: 'SPRING-20',
          now: PAST_RESERVATION,
          canRelease: async () => true,
        }),
      ).toBe(1);
    });

    it('never touches a redeemed redemption', async () => {
      const { fake, startWithCode } = couponSetup();
      const created = await startWithCode();
      await settleOrderPaid({
        coreTable: fake.coreTable,
        order: created,
        now: LATER,
      });
      expect(await reclaim(fake, '2030-01-01T00:00:00.000Z')).toBe(0);
      expect(fake.rows('couponRedemption')).toHaveLength(1);
      expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
    });

    it('lets a claim succeed at the limit once the expired reservation is freed', async () => {
      const { fake, startWithCode } = couponSetup(0, { maxRedemptions: 1 });
      await startWithCode('user-1');
      await expect(startWithCode('user-2')).rejects.toBeInstanceOf(
        CheckoutStartCancelledError,
      );
      await reclaim(fake, PAST_RESERVATION);
      await expect(startWithCode('user-2')).resolves.toMatchObject({
        userId: 'user-2',
      });
    });
  });
});

describe('startFreeOrder', () => {
  const discount = {
    discountAmount: 1999,
    couponCode: 'FREE',
    couponType: 'percent' as const,
    couponValue: 100,
  };
  const freeSetup = (extra: Record<string, unknown> = {}) => {
    const s = setup();
    s.fake.put('coupon', {
      courseId: 'course-1',
      code: 'FREE',
      type: 'percent',
      value: 100,
      enabled: true,
      redeemedCount: 0,
      ...extra,
    });
    const startFree = (userId = 'user-1') =>
      startFreeOrder({
        coreTable: s.fake.coreTable,
        course,
        userId,
        now: NOW,
        getConnection: s.getConnection,
        discount,
        extraWrites: (entities, created) =>
          claimCouponWrites(entities, {
            coupon: { courseId: 'course-1', code: 'FREE' },
            userId,
            orderId: created.orderId,
            status: 'redeemed',
            now: NOW,
          }),
      });
    return { ...s, startFree };
  };

  it('writes a paid order of nothing, the redemption and the enrolment in one transaction', async () => {
    const { fake, startFree } = freeSetup();
    const created = await startFree();
    expect(fake.log.transactions).toBe(1);
    expect(created).toMatchObject({
      status: 'paid',
      amount: 0,
      listAmount: 1999,
      paidAt: NOW,
      expiresAt: NOW,
      accountId: 'acct_1',
      mode: 'test',
      ...discount,
    });
    expect(created).not.toHaveProperty('checkoutSessionId');
    expect(fake.row('order', created)?.status).toBe('paid');
    expect(fake.rows('couponRedemption')[0]).toMatchObject({
      status: 'redeemed',
      orderId: created.orderId,
    });
    expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
    expect(fake.rows('enrolment')).toHaveLength(1);
    expect(fake.rows('enrolment')[0]).toMatchObject({
      userId: 'user-1',
      orderId: created.orderId,
    });
    expect(fake.rows('paymentConnection')[0]?.latestCheckoutExpiresAt).toBe(
      NOW,
    );
  });

  it('restores a dropped enrolment with the order set, keeping a completion', async () => {
    const { fake, startFree } = freeSetup();
    fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'dropped',
      completedAt: EARLIER,
    });
    const created = await startFree();
    expect(fake.rows('enrolment')[0]).toMatchObject({
      status: 'completed',
      orderId: created.orderId,
    });
  });

  it('writes nothing for a used up code, an enrolled student or an unpublished course', async () => {
    const used = freeSetup({ maxRedemptions: 1, redeemedCount: 1 });
    await expect(used.startFree()).rejects.toBeInstanceOf(
      CheckoutStartCancelledError,
    );
    expect(used.fake.rows('order')).toEqual([]);
    expect(used.fake.rows('enrolment')).toEqual([]);

    const enrolled = freeSetup();
    enrolled.fake.put('enrolment', {
      courseId: 'course-1',
      userId: 'user-1',
      status: 'active',
    });
    await expect(enrolled.startFree()).rejects.toBeInstanceOf(
      CheckoutStartCancelledError,
    );
    expect(enrolled.fake.rows('order')).toEqual([]);

    const draft = freeSetup();
    draft.fake.rows('course')[0]!.status = 'draft';
    await expect(draft.startFree()).rejects.toBeInstanceOf(
      CheckoutStartCancelledError,
    );
    expect(draft.fake.rows('order')).toEqual([]);
    expect(draft.fake.rows('enrolment')).toEqual([]);
  });

  it('refuses when payments are not connected, writing nothing', async () => {
    const { fake, startFree } = freeSetup();
    fake.put('paymentConnection', { ...connection, status: 'changing' });
    await expect(startFree()).rejects.toBeInstanceOf(PaymentsUnavailableError);
    expect(fake.rows('order')).toEqual([]);
    expect(fake.rows('couponRedemption')).toEqual([]);
  });

  it('leaves one enrolment, one order and one redemption when pressed twice at once', async () => {
    const { fake, startFree } = freeSetup();
    const results = await Promise.allSettled([startFree(), startFree()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fake.rows('order')).toHaveLength(1);
    expect(fake.rows('couponRedemption')).toHaveLength(1);
    expect(fake.rows('enrolment')).toHaveLength(1);
    expect(fake.rows('coupon')[0]?.redeemedCount).toBe(1);
  });

  it('refuses a discount that leaves something to charge', async () => {
    const { fake, getConnection } = setup();
    await expect(
      startFreeOrder({
        coreTable: fake.coreTable,
        course,
        userId: 'u',
        now: NOW,
        getConnection,
        discount: { ...discount, discountAmount: 1000 },
        extraWrites: () => [],
      }),
    ).rejects.toThrow();
    expect(fake.rows('order')).toEqual([]);
  });
});

describe('markRefundFailed', () => {
  const paid = (over: Partial<OrderRecord> = {}) =>
    order({ status: 'paid', paidAt: NOW, paymentIntentId: 'pi', ...over });
  const mark = (fake: ReturnType<typeof setup>['fake'], now = LATER) =>
    markRefundFailed({
      coreTable: fake.coreTable,
      order: { orderId: 'order-1' },
      now,
    });

  it('sets refundFailedAt once on a requested refund, leaving the status', async () => {
    const { fake } = setup();
    fake.put('order', paid({ refundRequestedAt: NOW }));
    await mark(fake);
    await mark(fake, '2026-11-20T00:00:00.000Z');
    expect(fake.row('order', { orderId: 'order-1' })).toMatchObject({
      status: 'paid',
      refundFailedAt: LATER,
    });
  });

  it('is a no-op when no refund was requested', async () => {
    const { fake } = setup();
    fake.put('order', paid());
    await expect(mark(fake)).resolves.toBe(false);
    expect(
      fake.row('order', { orderId: 'order-1' })?.refundFailedAt,
    ).toBeUndefined();
  });
});

describe('reverseRefund', () => {
  const refunded = (over: Partial<OrderRecord> = {}) =>
    order({
      status: 'refunded',
      paidAt: NOW,
      paymentIntentId: 'pi',
      refundReason: 'requested',
      refundRequestedAt: NOW,
      refundedAt: NOW,
      refundedAmount: 1999,
      ...over,
    });
  const reverse = (fake: ReturnType<typeof setup>['fake']) =>
    reverseRefund({
      coreTable: fake.coreTable,
      order: { orderId: 'order-1' },
      now: LATER,
    });
  const enrolment = (over: Record<string, unknown> = {}) => ({
    courseId: 'course-1',
    userId: 'user-1',
    status: 'dropped',
    orderId: 'order-1',
    ...over,
  });
  const key = { courseId: 'course-1', userId: 'user-1' };

  it('puts the order back to paid with refundFailedAt and restores the enrolment', async () => {
    const { fake } = setup();
    fake.put('order', refunded());
    fake.put('enrolment', enrolment());
    await expect(reverse(fake)).resolves.toBe(true);
    const stored = fake.row('order', { orderId: 'order-1' });
    expect(stored).toMatchObject({
      status: 'paid',
      refundRequestedAt: NOW,
      refundFailedAt: LATER,
    });
    expect(stored?.refundedAt).toBeUndefined();
    expect(stored?.refundedAmount).toBeUndefined();
    expect(fake.row('enrolment', key)).toMatchObject({
      status: 'active',
      orderId: 'order-1',
    });
  });

  it('restores a completed enrolment to completed', async () => {
    const { fake } = setup();
    fake.put('order', refunded());
    fake.put('enrolment', enrolment({ completedAt: 'x' }));
    await reverse(fake);
    expect(fake.row('enrolment', key)).toMatchObject({ status: 'completed' });
  });

  it('is a no-op the second time', async () => {
    const { fake } = setup();
    fake.put('order', refunded());
    fake.put('enrolment', enrolment());
    await reverse(fake);
    const before = structuredClone(fake.row('order', { orderId: 'order-1' }));
    await expect(reverse(fake)).resolves.toBe(false);
    expect(fake.row('order', { orderId: 'order-1' })).toEqual(before);
  });

  it('leaves an enrolment bought again after the refund alone', async () => {
    const { fake } = setup();
    fake.put('order', refunded());
    fake.put('enrolment', enrolment({ status: 'active', orderId: 'order-2' }));
    await expect(reverse(fake)).resolves.toBe(true);
    expect(fake.row('enrolment', key)).toMatchObject({
      status: 'active',
      orderId: 'order-2',
    });
  });

  it.each(['duplicate', 'unavailable', 'mismatch'] as const)(
    'leaves an order refunded as %s alone',
    async (reason) => {
      const { fake } = setup();
      fake.put('order', refunded({ refundReason: reason }));
      await expect(reverse(fake)).resolves.toBe(false);
      expect(fake.row('order', { orderId: 'order-1' })?.status).toBe(
        'refunded',
      );
    },
  );

  it('leaves a paid order alone', async () => {
    const { fake } = setup();
    fake.put(
      'order',
      order({ status: 'paid', paidAt: NOW, paymentIntentId: 'pi' }),
    );
    await expect(reverse(fake)).resolves.toBe(false);
  });
});
