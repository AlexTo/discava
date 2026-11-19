/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateFee, calculateRefund, calculateSale } from '../revenue.js';
import type { InvariantName } from './index.js';
import type { TableSnapshot } from './snapshot.js';
import { checkTableInvariants, consistentTable } from './test-fixture.js';

type Entry = TableSnapshot['earningEntries'][number];

const PAID_AT = '2026-01-05T00:10:00.000Z';
const REFUND_AT = '2026-01-06T09:00:00.000Z';
const INSTRUCTORS = ['a', 'b'];

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});

const EARNINGS: string[] = [
  'earning-identity',
  'earning-matches-order',
  'earning-refunds-capped',
  'earning-day-matches-entries',
  'payout-matches-entries',
  'payout-account-shape',
];

// The earnings checks only: the order itself is another topic's to check.
const earningViolations = () =>
  checkTableInvariants(table).filter((v) => EARNINGS.includes(v.invariant));

const violationsOf = (invariant: InvariantName) =>
  checkTableInvariants(table).filter((v) => v.invariant === invariant);

const order = (overrides: Partial<TableSnapshot['orders'][number]> = {}) => ({
  orderId: 'o1',
  userId: 'student',
  courseId: 'c1',
  accountId: 'acct_1',
  mode: 'test' as const,
  listAmount: 1000,
  amount: 800,
  currency: 'USD',
  status: 'paid' as const,
  expiresAt: '2026-01-05T01:00:00.000Z',
  checkoutSessionId: 'cs_1',
  paymentIntentId: 'pi_1',
  paidAt: PAID_AT,
  createdAt: '2026-01-05T00:00:00.000Z',
  ...overrides,
});

const context = {
  courseId: 'c1',
  orderId: 'o1',
  accountId: 'acct_1',
  mode: 'test' as const,
  currency: 'USD',
  feeBasisPoints: 2000,
};

const saleEntries = (): Entry[] =>
  calculateSale({
    grossMinor: 1000,
    paidMinor: 800,
    feeBasisPoints: 2000,
    instructorIds: INSTRUCTORS,
  }).map((share) => ({
    ...context,
    instructorId: share.instructorId,
    entryId: 'sale-o1',
    kind: 'sale' as const,
    grossMinor: share.grossMinor,
    discountMinor: share.discountMinor,
    refundMinor: 0,
    feeMinor: share.feeMinor,
    netMinor: share.netMinor,
    occurredAt: PAID_AT,
    releaseAt: '2026-01-19T00:10:00.000Z',
    settlement: `open#${share.instructorId}`,
  }));

const refundEntries = (recorded: number, total: number): Entry[] =>
  calculateRefund({
    grossMinor: 1000,
    paidMinor: 800,
    feeBasisPoints: 2000,
    instructorIds: INSTRUCTORS,
    recordedRefundedMinor: recorded,
    refundedTotalMinor: total,
  }).map((share) => ({
    ...context,
    instructorId: share.instructorId,
    entryId: `refund-o1-${total}`,
    kind: 'refund' as const,
    grossMinor: 0,
    discountMinor: 0,
    refundMinor: share.refundMinor,
    feeMinor: share.feeMinor,
    netMinor: share.netMinor,
    occurredAt: REFUND_AT,
    releaseAt: REFUND_AT,
    settlement: `open#${share.instructorId}`,
  }));

// The day rows the entries add up to, as the writer keeps them.
const dayRows = (entries: Entry[]) => {
  const rows = new Map<string, TableSnapshot['earningDays'][number]>();
  for (const e of entries) {
    const day = e.occurredAt.slice(0, 10);
    const key = `${e.instructorId}|${day}`;
    const row = rows.get(key) ?? {
      instructorId: e.instructorId,
      courseId: e.courseId,
      currency: e.currency,
      day,
      salesCount: 0,
      grossMinor: 0,
      discountMinor: 0,
      refundMinor: 0,
      feeMinor: 0,
      netMinor: 0,
    };
    row.salesCount = (row.salesCount ?? 0) + (e.kind === 'sale' ? 1 : 0);
    for (const f of [
      'grossMinor',
      'discountMinor',
      'refundMinor',
      'feeMinor',
      'netMinor',
    ] as const) {
      row[f] = (row[f] ?? 0) + e[f];
    }
    rows.set(key, row);
  }
  return [...rows.values()];
};

// A paid order with its ledger: one sale, optionally refunded in steps.
const ledger = (refundSteps: number[] = []) => {
  table.orders = [order({ refundedAmount: refundSteps.at(-1) ?? undefined })];
  table.earningOrders = [
    {
      orderId: 'o1',
      courseId: 'c1',
      currency: 'USD',
      accountId: 'acct_1',
      mode: 'test',
      grossMinor: 1000,
      discountMinor: 200,
      paidMinor: 800,
      feeMinor: calculateFee(800, 2000),
      feeBasisPoints: 2000,
      instructorIds: INSTRUCTORS,
      refundedMinor: refundSteps.at(-1) ?? 0,
    },
  ];
  let recorded = 0;
  const entries = [...saleEntries()];
  for (const total of refundSteps) {
    entries.push(...refundEntries(recorded, total));
    recorded = total;
  }
  table.earningEntries = entries;
  table.earningDays = dayRows(entries);
  table.users.push(...INSTRUCTORS.map((userId) => ({ userId })));
};

const payoutOf = (
  overrides: Partial<TableSnapshot['payouts'][number]> = {},
): TableSnapshot['payouts'][number] => ({
  instructorId: 'a',
  payoutId: 'p1',
  accountId: 'acct_1',
  mode: 'test',
  currency: 'USD',
  status: 'pending',
  amountMinor: 320,
  entryCount: 1,
  ...overrides,
});

// Instructor a's sale entry taken by a payout.
const takeBy = (payoutId: string) => {
  const entry = table.earningEntries.find((e) => e.instructorId === 'a')!;
  entry.payoutId = payoutId;
  entry.settlement = `payout#${payoutId}`;
};

describe('earnings', () => {
  it('accepts a consistent ledger, in whole and in part', () => {
    ledger([]);
    expect(earningViolations()).toEqual([]);
    ledger([300]);
    expect(earningViolations()).toEqual([]);
    ledger([300, 800]);
    expect(earningViolations()).toEqual([]);
  });

  it('accepts a ledger with a payout that took an entry', () => {
    ledger();
    takeBy('p1');
    table.payouts = [payoutOf()];
    expect(earningViolations()).toEqual([]);
  });

  describe('timing: recording is asynchronous', () => {
    it('does not report a paid order that has no entries yet', () => {
      table.orders = [order()];
      expect(earningViolations()).toEqual([]);
    });

    it("does not report an earningOrder whose refundedMinor is below the order's refundedAmount", () => {
      ledger([300]);
      table.orders[0].refundedAmount = 800;
      expect(violationsOf('earning-refunds-capped')).toEqual([]);
      expect(earningViolations()).toEqual([]);
    });
  });

  describe('earning-identity', () => {
    it('reports a net that is not gross - discount - refund - fee', () => {
      ledger();
      table.earningEntries[0].netMinor += 1;
      expect(violationsOf('earning-identity')[0]?.message).toMatch(/net/);
    });

    it('reports an amount that is not an integer', () => {
      ledger();
      table.earningEntries[0].feeMinor = 80.5;
      expect(violationsOf('earning-identity')[0]?.message).toMatch(
        /not an integer/,
      );
    });

    it('reports a sale entry with a refund amount', () => {
      ledger();
      table.earningEntries[0].refundMinor = 5;
      table.earningEntries[0].netMinor -= 5;
      expect(violationsOf('earning-identity')[0]?.message).toMatch(
        /a sale, but refundMinor/,
      );
    });

    it('reports a refund entry with gross, or that takes fee', () => {
      ledger([300]);
      const refund = table.earningEntries.find((e) => e.kind === 'refund')!;
      refund.grossMinor = 1;
      refund.netMinor += 1;
      expect(violationsOf('earning-identity')[0]?.message).toMatch(
        /gross or discount/,
      );
      refund.grossMinor = 0;
      refund.feeMinor = 3;
      refund.netMinor = -refund.refundMinor - 3;
      expect(violationsOf('earning-identity')[0]?.message).toMatch(/takes fee/);
    });
  });

  describe('earning-matches-order', () => {
    it.each([
      [
        'pending',
        {
          status: 'pending' as const,
          paidAt: undefined,
          paymentIntentId: undefined,
        },
      ],
      [
        'refunded as a duplicate',
        {
          status: 'refunded' as const,
          refundReason: 'duplicate' as const,
          refundedAt: REFUND_AT,
        },
      ],
      ['an amount of 0', { amount: 0 }],
    ])('reports an earningOrder for an order that is %s', (_name, change) => {
      ledger();
      Object.assign(table.orders[0], change);
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /not a sale/.test(v.message),
        ),
      ).toBe(true);
    });

    it('accepts an order refunded on request', () => {
      ledger([800]);
      Object.assign(table.orders[0], {
        status: 'refunded',
        refundReason: 'requested',
        refundedAt: REFUND_AT,
        refundedAmount: 800,
      });
      expect(violationsOf('earning-matches-order')).toEqual([]);
    });

    it('reports an earningOrder with no order', () => {
      ledger();
      table.orders = [];
      expect(violationsOf('earning-matches-order')[0]?.message).toMatch(
        /no such order/,
      );
    });

    it.each(['accountId', 'mode'] as const)(
      "reports an entry whose %s differs from its order's",
      (field) => {
        ledger();
        (table.earningEntries[0] as Record<string, string>)[field] =
          field === 'mode' ? 'live' : 'acct_other';
        expect(violationsOf('earning-matches-order')[0]?.message).toMatch(
          new RegExp(field),
        );
      },
    );

    it.each(['accountId', 'mode'] as const)(
      "reports an earningOrder whose %s differs from its order's",
      (field) => {
        ledger();
        (table.earningOrders[0] as Record<string, string>)[field] =
          field === 'mode' ? 'live' : 'acct_other';
        expect(
          violationsOf('earning-matches-order').some((v) =>
            new RegExp(field).test(v.message),
          ),
        ).toBe(true);
      },
    );

    it('reports an entry with no earningOrder', () => {
      ledger();
      table.earningOrders = [];
      expect(violationsOf('earning-matches-order')[0]?.message).toMatch(
        /no earningOrder/,
      );
    });

    it("reports entries that do not add up to the order's amount, list amount or fee", () => {
      ledger();
      table.earningEntries[0].discountMinor += 1;
      table.earningEntries[0].netMinor -= 1;
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /paidMinor/.test(v.message),
        ),
      ).toBe(true);

      ledger();
      table.earningEntries[0].grossMinor += 1;
      table.earningEntries[0].netMinor += 1;
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /sale gross/.test(v.message),
        ),
      ).toBe(true);

      ledger();
      table.earningEntries[0].feeMinor += 1;
      table.earningEntries[0].netMinor -= 1;
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /sale fee/.test(v.message),
        ),
      ).toBe(true);
    });

    it('reports a fee that is not the rounded one, and figures that differ from the order', () => {
      ledger();
      table.earningOrders[0].feeMinor = 159;
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /rounded fee/.test(v.message),
        ),
      ).toBe(true);

      ledger();
      table.orders[0].amount = 700;
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /paidMinor/.test(v.message),
        ),
      ).toBe(true);
    });

    it('reports a recipient with no sale entry, and a sale entry for a stranger', () => {
      ledger();
      table.earningEntries = table.earningEntries.filter(
        (e) => e.instructorId !== 'b',
      );
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /instructor b has 0 sale/.test(v.message),
        ),
      ).toBe(true);

      ledger();
      table.earningEntries[0].instructorId = 'stranger';
      expect(
        violationsOf('earning-matches-order').some((v) =>
          /not a recipient/.test(v.message),
        ),
      ).toBe(true);
    });
  });

  describe('earning-refunds-capped', () => {
    it('reports refund entries that exceed the sale', () => {
      ledger([800]);
      const refund = table.earningEntries.find((e) => e.kind === 'refund')!;
      refund.refundMinor += 100;
      refund.netMinor -= 100;
      expect(
        violationsOf('earning-refunds-capped').some((v) =>
          /refund entries add up/.test(v.message),
        ),
      ).toBe(true);
    });

    it('reports a refunded total over the amount paid', () => {
      ledger([800]);
      table.earningOrders[0].refundedMinor = 900;
      table.orders[0].refundedAmount = 900;
      expect(
        violationsOf('earning-refunds-capped').some((v) =>
          /exceeds paidMinor/.test(v.message),
        ),
      ).toBe(true);
    });

    it('reports a refunded total over what the order says is refunded', () => {
      ledger([300]);
      table.orders[0].refundedAmount = 200;
      expect(
        violationsOf('earning-refunds-capped').some((v) =>
          /refundedAmount/.test(v.message),
        ),
      ).toBe(true);
    });

    it('reports a refund entry returning more fee or net than its sale entry', () => {
      ledger([300]);
      const refund = table.earningEntries.find(
        (e) => e.kind === 'refund' && e.instructorId === 'a',
      )!;
      refund.feeMinor = -1000;
      refund.netMinor = -refund.refundMinor + 1000;
      expect(
        violationsOf('earning-refunds-capped').some((v) =>
          /more than the sale's/.test(v.message),
        ),
      ).toBe(true);
    });

    it("reports a fully refunded order whose refund fee or net differs from the sale's", () => {
      ledger([800]);
      const refund = table.earningEntries.find(
        (e) => e.kind === 'refund' && e.instructorId === 'a',
      )!;
      refund.feeMinor += 1;
      refund.netMinor += 1;
      expect(
        violationsOf('earning-refunds-capped').some((v) =>
          /fully refunded/.test(v.message),
        ),
      ).toBe(true);
    });
  });

  describe('earning-day-matches-entries', () => {
    it('reports a summary row that differs from its entries', () => {
      ledger();
      table.earningDays[0].netMinor = (table.earningDays[0].netMinor ?? 0) + 1;
      expect(violationsOf('earning-day-matches-entries')[0]?.message).toMatch(
        /netMinor/,
      );
      ledger();
      table.earningDays[0].salesCount = 2;
      expect(violationsOf('earning-day-matches-entries')[0]?.message).toMatch(
        /salesCount/,
      );
    });

    it('reports an entry with no row', () => {
      ledger();
      table.earningDays = table.earningDays.slice(1);
      expect(violationsOf('earning-day-matches-entries')[0]?.message).toMatch(
        /no day row/,
      );
    });

    it('sums the entries of one day, sales and refunds alike', () => {
      ledger([300, 800]);
      expect(
        table.earningDays.filter((d) => d.instructorId === 'a'),
      ).toHaveLength(2);
      expect(violationsOf('earning-day-matches-entries')).toEqual([]);
    });
  });

  describe('payout-matches-entries', () => {
    it('reports an entry whose payoutId names no payout', () => {
      ledger();
      takeBy('ghost');
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /names no payout/,
      );
    });

    it.each([
      ['instructor', { instructorId: 'b' }],
      ['currency', { currency: 'EUR' }],
      ['payment account', { accountId: 'acct_other' }],
      ['mode', { mode: 'live' as const }],
    ])('reports a payout of another %s', (_name, change) => {
      ledger();
      takeBy('p1');
      table.payouts = [payoutOf(change)];
      expect(
        violationsOf('payout-matches-entries').some((v) =>
          /payout p1 has/.test(v.message),
        ),
      ).toBe(true);
    });

    it('reports an entry whose settlement key disagrees with its payoutId', () => {
      ledger();
      takeBy('p1');
      table.payouts = [payoutOf()];
      table.earningEntries[0].settlement = 'open#a';
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /settlement/,
      );
    });

    it("reports a pending payout whose amount or count differs from its entries'", () => {
      ledger();
      takeBy('p1');
      table.payouts = [payoutOf({ amountMinor: 321 })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /amountMinor/,
      );
      table.payouts = [payoutOf({ entryCount: 2 })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /entryCount/,
      );
    });

    it('reports a pending payout that is not above 0', () => {
      ledger();
      table.payouts = [payoutOf({ amountMinor: 0, entryCount: 0 })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /not above 0/,
      );
    });

    it('reports a sent payout with no transfer ID, and a pending one with one', () => {
      ledger();
      takeBy('p1');
      table.payouts = [payoutOf({ status: 'sent' })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /no transfer ID/,
      );
      table.payouts = [payoutOf({ transferId: 'tr_1' })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /transfer ID is set/,
      );
      table.payouts = [payoutOf({ status: 'sent', transferId: 'tr_1' })];
      expect(violationsOf('payout-matches-entries')).toEqual([]);
    });

    it('reports a failed payout that still owns entries or has no reason', () => {
      ledger();
      takeBy('p1');
      table.payouts = [payoutOf({ status: 'failed', failureReason: 'closed' })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /still owns 1 entries/,
      );
      table.earningEntries[0].payoutId = undefined;
      table.earningEntries[0].settlement = 'open#a';
      table.payouts = [payoutOf({ status: 'failed' })];
      expect(violationsOf('payout-matches-entries')[0]?.message).toMatch(
        /no reason/,
      );
      table.payouts = [payoutOf({ status: 'failed', failureReason: 'closed' })];
      expect(violationsOf('payout-matches-entries')).toEqual([]);
    });
  });

  describe('payout-account-shape', () => {
    const account = (
      overrides: Partial<TableSnapshot['payoutAccounts'][number]> = {},
    ) => ({
      instructorId: 'teacher',
      accountId: 'acct_1',
      mode: 'test' as const,
      connectedAccountId: 'acct_connected',
      status: 'active' as const,
      ...overrides,
    });

    it('accepts one account per payment account for an instructor with a user', () => {
      table.payoutAccounts = [
        account(),
        account({ accountId: 'acct_2' }),
        account({ mode: 'live' }),
      ];
      expect(violationsOf('payout-account-shape')).toEqual([]);
    });

    it('reports two accounts for one instructor and payment account', () => {
      table.payoutAccounts = [
        account(),
        account({ connectedAccountId: 'acct_other' }),
      ];
      expect(violationsOf('payout-account-shape')[0]?.message).toMatch(
        /2 accounts/,
      );
    });

    it('reports an unknown status', () => {
      table.payoutAccounts = [account({ status: 'odd' as never })];
      expect(violationsOf('payout-account-shape')[0]?.message).toMatch(
        /status odd/,
      );
    });

    it('reports an account with no user', () => {
      table.payoutAccounts = [account({ instructorId: 'nobody' })];
      expect(violationsOf('payout-account-shape')[0]?.message).toMatch(
        /no user record/,
      );
    });
  });

  it('keeps the new entities out of the student-activity checks', () => {
    ledger([300]);
    takeBy('p1');
    table.payouts = [payoutOf()];
    table.payoutAccounts = [
      {
        instructorId: 'a',
        accountId: 'acct_1',
        mode: 'test',
        connectedAccountId: 'acct_connected',
        status: 'active',
      },
    ];
    const names = checkTableInvariants(table).map((v) => v.invariant);
    expect(names).not.toContain('activity-count-matches-students');
    expect(names.filter((n) => n.startsWith('student-records-'))).toEqual([]);
  });
});
