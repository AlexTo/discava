/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import { couponPreview } from './coupon.js';

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, any>,
  reads: [] as { entity: string; key: any }[],
  writes: [] as string[],
}));

// Every entity answers keyed gets from `mocks.db` and records them; any write
// is recorded, and fails the test that made it.
vi.mock('@discava/core-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => ({
    entities: new Proxy(
      {},
      {
        get: (_, entity: string) =>
          new Proxy(
            {
              get: (key: any) => ({
                go: async () => {
                  mocks.reads.push({ entity, key });
                  return { data: mocks.db[entity] ?? null };
                },
              }),
            },
            {
              get: (target, method: string) =>
                (target as any)[method] ??
                (() => {
                  mocks.writes.push(`${entity}.${method}`);
                  throw new Error(`unexpected ${entity}.${method}`);
                }),
            },
          ),
      },
    ),
    transaction: {
      write: () => {
        mocks.writes.push('transaction');
        throw new Error('unexpected transaction');
      },
    },
  })),
}));

const router = t.router({ preview: couponPreview });
const caller = callerFor(router, { sub: 'student-1' });

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

const preview = (code = 'SPRING-20') =>
  caller.preview({ courseId: 'c1', code });
const refused = (message: string) =>
  expect.objectContaining({ code: 'PRECONDITION_FAILED', message });
const INVALID = 'This code is not valid for this course';

beforeEach(() => {
  mocks.db = { course, coupon };
  mocks.reads = [];
  mocks.writes = [];
});

describe('coupon.preview', () => {
  it.each([
    ['percent', { type: 'percent', value: 20 }, 980, 3920],
    ['100 percent', { type: 'percent', value: 100 }, 4900, 0],
    ['fixed', { type: 'fixed', value: 1000, currency: 'usd' }, 1000, 3900],
    [
      'fixed over the price',
      { type: 'fixed', value: 9000, currency: 'USD' },
      4900,
      0,
    ],
  ])('prices a %s code', async (_name, over, discountAmount, totalAmount) => {
    mocks.db.coupon = { ...coupon, ...over };
    expect(await preview()).toEqual({
      code: 'SPRING-20',
      listAmount: 4900,
      discountAmount,
      totalAmount,
      currency: 'usd',
      isFree: totalAmount === 0,
    });
  });

  it('takes lower case and padded input', async () => {
    expect(await preview('  spring-20 ')).toMatchObject({ code: 'SPRING-20' });
    expect(mocks.reads.find((r) => r.entity === 'coupon')?.key).toEqual({
      courseId: 'c1',
      code: 'SPRING-20',
    });
  });

  it.each([
    ['unknown', () => (mocks.db.coupon = undefined)],
    ['malformed', () => undefined, 'a b'],
    [
      "another course's",
      // The key names this course, so another course's code is simply absent.
      () => (mocks.db.coupon = undefined),
    ],
    [
      'fixed in another currency',
      () =>
        (mocks.db.coupon = {
          ...coupon,
          type: 'fixed',
          value: 500,
          currency: 'eur',
        }),
    ],
    [
      'on a free course',
      () => (mocks.db.course = { ...course, priceAmount: 0 }),
    ],
  ])('refuses %s with one identical message', async (_name, arrange, code) => {
    arrange();
    await expect(preview(code)).rejects.toEqual(refused(INVALID));
  });

  it.each([
    ['disabled', { enabled: false }, 'This code has been turned off'],
    [
      'expired',
      { expiresAt: '2020-01-01T00:00:00.000Z' },
      'This code has expired',
    ],
    [
      'used up',
      { maxRedemptions: 3, redeemedCount: 3 },
      'This code has been used the maximum number of times',
    ],
  ])('refuses a %s code', async (_name, over, message) => {
    mocks.db.coupon = { ...coupon, ...over };
    await expect(preview()).rejects.toEqual(refused(message));
  });

  it('refuses a student who already used the code, and one already enrolled', async () => {
    mocks.db.couponRedemption = { status: 'redeemed' };
    await expect(preview()).rejects.toEqual(
      refused('You have already used this code'),
    );
    mocks.db.couponRedemption = undefined;
    mocks.db.enrolment = { status: 'active' };
    await expect(preview()).rejects.toEqual(
      refused('You are already enrolled in this course'),
    );
    mocks.db.enrolment = { status: 'dropped' };
    expect(await preview()).toMatchObject({ totalAmount: 3920 });
  });

  it('does not count a student against the limit with their own reservation', async () => {
    mocks.db.coupon = { ...coupon, maxRedemptions: 1, redeemedCount: 1 };
    await expect(preview()).rejects.toEqual(
      refused('This code has been used the maximum number of times'),
    );
    mocks.db.couponRedemption = { status: 'reserved' };
    expect(await preview()).toMatchObject({ code: 'SPRING-20' });
  });

  it('refuses a total above zero but under the minimum charge', async () => {
    mocks.db.coupon = {
      ...coupon,
      type: 'fixed',
      value: 4880,
      currency: 'usd',
    };
    await expect(preview()).rejects.toEqual(
      refused('This code leaves a price too low to pay for'),
    );
  });

  it.each(['draft', 'archived'])(
    'is NOT_FOUND for a %s course',
    async (status) => {
      mocks.db.course = { ...course, status };
      await expect(preview()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      mocks.db.course = undefined;
      await expect(preview()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    },
  );

  it('writes nothing on any path, and reads the table with the caller as the student', async () => {
    await preview();
    mocks.db.coupon = { ...coupon, enabled: false };
    await preview().catch(() => undefined);
    expect(mocks.writes).toEqual([]);
    const redemptionReads = mocks.reads.filter(
      (r) => r.entity === 'couponRedemption' || r.entity === 'enrolment',
    );
    expect(redemptionReads.length).toBeGreaterThan(0);
    for (const { key } of redemptionReads) {
      expect(key.userId).toBe('student-1');
    }
  });
});
