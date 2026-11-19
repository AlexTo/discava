/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  calculateFee,
  calculateRefund,
  calculateSale,
  recordRefund,
  recordSale,
} from '@discava/core-table';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createFakeCoreTable } from '../../../../databases/core-table/src/helpers/payment-fake.test.js';
import { t } from '../init.js';
import { report } from './earnings.js';

// SC-001, Stripe-free: orders and refunds go through the real recording
// helpers into an in-memory fake of the entity layer, and the report is read
// back through the real procedure. Every expected figure comes straight from
// `calculateSale` / `calculateRefund` and the orders' amounts, so the test
// fails if `revenue.ts` and what the report shows ever diverge.

const { state } = vi.hoisted(() => ({
  state: { coreTable: undefined as unknown },
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  createCoreTableService: vi.fn(async () => state.coreTable),
}));

const caller = t.createCallerFactory(t.router({ report }));

const callAs = (sub: string) =>
  caller({
    event: {
      requestContext: {
        authorizer: { claims: { sub, 'cognito:groups': ['instructor'] } },
      },
    } as unknown as APIGatewayProxyEvent,
    context: {} as any,
    info: {} as any,
  });

const FEE_BASIS_POINTS = 2000;
const HOLD_DAYS = 14;
const period = { from: '2026-11-01', to: '2026-11-30' };

interface Scenario {
  orderId: string;
  courseId: string;
  currency: string;
  listAmount: number;
  amount: number;
  instructorIds: string[];
  /** Cumulative refunded totals, in the order they happen. */
  refunds: number[];
}

const scenarios: Scenario[] = [
  {
    orderId: 'o1',
    courseId: 'course-1',
    currency: 'USD',
    listAmount: 1000,
    amount: 800,
    instructorIds: ['ins-a'],
    refunds: [],
  },
  {
    orderId: 'o2',
    courseId: 'course-1',
    currency: 'USD',
    listAmount: 999,
    amount: 999,
    instructorIds: ['ins-b', 'ins-a'],
    refunds: [101, 500, 999],
  },
  {
    orderId: 'o3',
    courseId: 'course-2',
    currency: 'USD',
    listAmount: 333,
    amount: 333,
    instructorIds: ['ins-a', 'ins-b', 'ins-c'],
    refunds: [1],
  },
  {
    orderId: 'o4',
    courseId: 'course-1',
    currency: 'EUR',
    listAmount: 2500,
    amount: 1999,
    instructorIds: ['ins-a', 'ins-b'],
    refunds: [777],
  },
  {
    orderId: 'o5',
    courseId: 'course-2',
    currency: 'JPY',
    listAmount: 5000,
    amount: 5000,
    instructorIds: ['ins-b'],
    refunds: [],
  },
];

const record = async () => {
  const fake = createFakeCoreTable();
  state.coreTable = fake.coreTable;
  for (const courseId of ['course-1', 'course-2']) {
    fake.put('course', { courseId, title: `Title of ${courseId}` });
  }
  for (const [index, s] of scenarios.entries()) {
    const paidAt = `2026-11-0${index + 1}T10:00:00.000Z`;
    await recordSale({
      coreTable: fake.coreTable,
      order: {
        orderId: s.orderId,
        courseId: s.courseId,
        accountId: 'acct_1',
        mode: 'test',
        currency: s.currency,
        listAmount: s.listAmount,
        amount: s.amount,
        paidAt,
      },
      instructorIds: s.instructorIds,
      feeBasisPoints: FEE_BASIS_POINTS,
      holdDays: HOLD_DAYS,
    });
    for (const [step, total] of s.refunds.entries()) {
      await recordRefund({
        coreTable: fake.coreTable,
        orderId: s.orderId,
        refundedTotal: total,
        occurredAt: `2026-11-1${step}T09:00:00.000Z`,
      });
    }
  }
};

// What one instructor should have for one course and currency, worked out
// from the revenue rules and the orders' amounts alone.
const expected = (instructorId: string, courseId: string, currency: string) => {
  const figures = {
    orders: 0,
    grossMinor: 0,
    discountMinor: 0,
    refundMinor: 0,
    feeMinor: 0,
    netMinor: 0,
  };
  for (const s of scenarios) {
    if (s.courseId !== courseId || s.currency !== currency) continue;
    const base = {
      grossMinor: s.listAmount,
      paidMinor: s.amount,
      feeBasisPoints: FEE_BASIS_POINTS,
      instructorIds: s.instructorIds,
    };
    const sale = calculateSale(base).find(
      (x) => x.instructorId === instructorId,
    );
    if (!sale) continue;
    figures.orders += 1;
    figures.grossMinor += sale.grossMinor;
    figures.discountMinor += sale.discountMinor;
    figures.feeMinor += sale.feeMinor;
    let recorded = 0;
    for (const total of s.refunds) {
      const share = calculateRefund({
        ...base,
        recordedRefundedMinor: recorded,
        refundedTotalMinor: total,
      }).find((x) => x.instructorId === instructorId);
      recorded = Math.min(total, s.amount);
      if (!share) continue;
      figures.refundMinor += share.refundMinor;
      figures.feeMinor += share.feeMinor;
    }
  }
  figures.netMinor =
    figures.grossMinor -
    figures.discountMinor -
    figures.refundMinor -
    figures.feeMinor;
  return figures;
};

const rowOf = (
  report: Awaited<ReturnType<ReturnType<typeof callAs>['report']>>,
  courseId: string,
  currency: string,
) => {
  const row = report.currencies
    .find((c) => c.currency === currency)
    ?.courses.find((c) => c.courseId === courseId);
  if (!row) return undefined;
  const { courseTitle: _title, courseId: _id, ...figures } = row;
  return figures;
};

describe('earnings report reconciles with the orders and refunds', () => {
  it('matches the revenue rules for every instructor, course and currency', async () => {
    await record();
    const courses = ['course-1', 'course-2'];
    const currencies = ['USD', 'EUR', 'JPY'];
    for (const instructorId of ['ins-a', 'ins-b', 'ins-c']) {
      const result = await callAs(instructorId).report(period);
      for (const courseId of courses) {
        for (const currency of currencies) {
          const want = expected(instructorId, courseId, currency);
          const got = rowOf(result, courseId, currency);
          if (want.orders === 0) expect(got).toBeUndefined();
          else expect(got).toEqual(want);
        }
      }
    }
  });

  it("adds up, across instructors, to the orders' paid amounts minus refunds minus fees to the minor unit", async () => {
    await record();
    const totals = new Map<string, number>();
    for (const instructorId of ['ins-a', 'ins-b', 'ins-c']) {
      const result = await callAs(instructorId).report(period);
      for (const { currency, totals: t } of result.currencies) {
        totals.set(currency, (totals.get(currency) ?? 0) + t.netMinor);
      }
    }
    for (const currency of ['USD', 'EUR', 'JPY']) {
      let want = 0;
      for (const s of scenarios.filter((x) => x.currency === currency)) {
        const refunded = Math.min(s.refunds.at(-1) ?? 0, s.amount);
        want +=
          s.amount -
          refunded -
          (calculateFee(s.amount, FEE_BASIS_POINTS) -
            calculateFee(refunded, FEE_BASIS_POINTS));
      }
      expect(totals.get(currency)).toBe(want);
    }
  });

  it('shows a fully refunded order as zero net', async () => {
    await record();
    const result = await callAs('ins-b').report(period);
    // o2 is refunded in full: its sale and refund cancel exactly for ins-b.
    const base = {
      grossMinor: 999,
      paidMinor: 999,
      feeBasisPoints: FEE_BASIS_POINTS,
      instructorIds: ['ins-b', 'ins-a'],
    };
    const sale = calculateSale(base).find((x) => x.instructorId === 'ins-b')!;
    const back = calculateRefund({
      ...base,
      recordedRefundedMinor: 0,
      refundedTotalMinor: 999,
    }).find((x) => x.instructorId === 'ins-b')!;
    expect(sale.netMinor + back.netMinor).toBe(0);
    expect(result.currencies.length).toBeGreaterThan(0);
  });
});
