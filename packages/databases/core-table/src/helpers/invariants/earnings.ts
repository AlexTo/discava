/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PAYOUT_ACCOUNT_STATUSES } from '../../entities/payout-account.js';
import { calculateFee } from '../revenue.js';
import { type Check, groupBy, type Violation, violation } from './common.js';
import type { TableSnapshot } from './snapshot.js';

// Instructor earnings: the ledger of sales and refunds, its per-day summaries,
// and the payouts that settle it. Every check runs from the ledger towards
// the order, never the other way: recording is asynchronous, so a paid order
// with no entries yet, or an `earningOrder` whose refunded total is still
// below the order's `refundedAmount`, is not a violation.

type Entry = TableSnapshot['earningEntries'][number];
type Order = TableSnapshot['orders'][number];

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

const sum = (entries: Entry[], field: keyof Entry & `${string}Minor`) =>
  entries.reduce((total, entry) => total + (entry[field] as number), 0);

// An order is a sale when it is paid, or refunded on request after being paid
// (an operator's refund), and it took money. One refunded automatically as
// undeliverable, a pending or expired one and a fully discounted one are not.
const isSale = (order: Order) =>
  (order.status === 'paid' ||
    (order.status === 'refunded' && order.refundReason === 'requested')) &&
  order.amount > 0;

const entryKey = (entry: Entry) => ({
  instructorId: entry.instructorId,
  courseId: entry.courseId,
  entryId: entry.entryId,
});

const dayOf = (iso: string) => {
  const time = new Date(iso);
  return Number.isNaN(time.getTime())
    ? iso.slice(0, 10)
    : time.toISOString().slice(0, 10);
};

// Every entry's amounts are integers, its net is gross - discount - refund -
// fee, a sale entry refunds nothing, and a refund entry has no gross or
// discount and never takes fee.
export const checkEarningIdentity = (snapshot: TableSnapshot): Violation[] =>
  snapshot.earningEntries.flatMap((entry) => {
    const problems: string[] = [];
    const figures = [
      'grossMinor',
      'discountMinor',
      'refundMinor',
      'feeMinor',
      'netMinor',
      'feeBasisPoints',
    ] as const;
    const whole = figures.filter((field) => !isInteger(entry[field]));
    for (const field of whole) {
      problems.push(`${field} ${entry[field]} is not an integer`);
    }
    if (whole.length === 0) {
      const net =
        entry.grossMinor -
        entry.discountMinor -
        entry.refundMinor -
        entry.feeMinor;
      if (entry.netMinor !== net) {
        problems.push(
          `net ${entry.netMinor} is not gross - discount - refund - fee (${net})`,
        );
      }
      if (entry.kind === 'sale' && entry.refundMinor !== 0) {
        problems.push(`a sale, but refundMinor is ${entry.refundMinor}`);
      }
      if (entry.kind === 'refund') {
        if (entry.grossMinor !== 0 || entry.discountMinor !== 0) {
          problems.push('a refund, but gross or discount is not 0');
        }
        if (entry.feeMinor > 0) {
          problems.push(`a refund, but feeMinor ${entry.feeMinor} takes fee`);
        }
      }
    }
    return problems.map((message) =>
      violation('earning-identity', entryKey(entry), message),
    );
  });

// Each `earningOrder` has an order that is a sale, the same course, currency
// and payment account, the order's figures and the rounded fee, and exactly
// one sale entry per instructor that add up to them; no entry is without its
// `earningOrder`.
export const checkEarningMatchesOrder = (
  snapshot: TableSnapshot,
): Violation[] => {
  const orders = new Map(snapshot.orders.map((o) => [o.orderId, o]));
  const earningOrders = new Map(
    snapshot.earningOrders.map((e) => [e.orderId, e]),
  );
  const entriesByOrder = groupBy(snapshot.earningEntries, (e) => e.orderId);

  const unmatched = snapshot.earningEntries
    .filter((entry) => !earningOrders.has(entry.orderId))
    .map((entry) =>
      violation(
        'earning-matches-order',
        entryKey(entry),
        `has no earningOrder for order ${entry.orderId}`,
      ),
    );

  const matched = snapshot.earningOrders.flatMap((earning) => {
    const record = { orderId: earning.orderId };
    const problems: string[] = [];
    const order = orders.get(earning.orderId);
    if (!order) {
      problems.push('there is no such order');
    } else {
      if (!isSale(order)) {
        problems.push(
          `the order is ${order.status}${order.refundReason ? ` (${order.refundReason})` : ''} with amount ${order.amount}, not a sale`,
        );
      }
      for (const field of [
        'courseId',
        'currency',
        'accountId',
        'mode',
      ] as const) {
        if (earning[field] !== order[field]) {
          problems.push(
            `${field} ${earning[field]} differs from the order's ${order[field]}`,
          );
        }
      }
      if (earning.grossMinor !== order.listAmount) {
        problems.push(
          `grossMinor ${earning.grossMinor} is not the order's listAmount ${order.listAmount}`,
        );
      }
      if (earning.paidMinor !== order.amount) {
        problems.push(
          `paidMinor ${earning.paidMinor} is not the order's amount ${order.amount}`,
        );
      }
    }
    if (
      isInteger(earning.paidMinor) &&
      isInteger(earning.feeBasisPoints) &&
      earning.feeBasisPoints >= 0 &&
      earning.feeBasisPoints <= 10000 &&
      earning.paidMinor >= 0
    ) {
      const fee = calculateFee(earning.paidMinor, earning.feeBasisPoints);
      if (earning.feeMinor !== fee) {
        problems.push(
          `feeMinor ${earning.feeMinor} is not the rounded fee ${fee}`,
        );
      }
    } else {
      problems.push('paidMinor or feeBasisPoints is not a valid whole number');
    }
    const sorted = [...earning.instructorIds].sort();
    if (sorted.join('\n') !== earning.instructorIds.join('\n')) {
      problems.push('instructorIds are not sorted');
    }

    const sales = (entriesByOrder.get(earning.orderId) ?? []).filter(
      (e) => e.kind === 'sale',
    );
    const salesBy = groupBy(sales, (e) => e.instructorId);
    for (const instructorId of earning.instructorIds) {
      const count = salesBy.get(instructorId)?.length ?? 0;
      if (count !== 1) {
        problems.push(
          `instructor ${instructorId} has ${count} sale entries, not 1`,
        );
      }
    }
    for (const instructorId of salesBy.keys()) {
      if (!earning.instructorIds.includes(instructorId)) {
        problems.push(`sale entry for ${instructorId}, who is not a recipient`);
      }
    }
    if (sales.length > 0) {
      if (sum(sales, 'grossMinor') !== earning.grossMinor) {
        problems.push(
          `sale gross ${sum(sales, 'grossMinor')} is not ${earning.grossMinor}`,
        );
      }
      const paid = sum(sales, 'grossMinor') - sum(sales, 'discountMinor');
      if (paid !== earning.paidMinor) {
        problems.push(
          `sale gross - discount ${paid} is not paidMinor ${earning.paidMinor}`,
        );
      }
      if (sum(sales, 'feeMinor') !== earning.feeMinor) {
        problems.push(
          `sale fee ${sum(sales, 'feeMinor')} is not ${earning.feeMinor}`,
        );
      }
    }
    for (const entry of entriesByOrder.get(earning.orderId) ?? []) {
      for (const field of [
        'courseId',
        'currency',
        'accountId',
        'mode',
      ] as const) {
        if (entry[field] !== earning[field]) {
          problems.push(
            `entry ${entry.entryId} has ${field} ${entry[field]}, not ${earning[field]}`,
          );
        }
      }
    }
    return problems.map((message) =>
      violation('earning-matches-order', record, message),
    );
  });

  return [...unmatched, ...matched];
};

// Per order, the refund entries add up to `earningOrder.refundedMinor`, which
// is at most the amount paid and at most what the order says is refunded; no
// instructor gives back more fee or net than their sale entry had, and once
// the whole amount is refunded each gives back exactly what they earned.
export const checkEarningRefundsCapped = (
  snapshot: TableSnapshot,
): Violation[] => {
  const orders = new Map(snapshot.orders.map((o) => [o.orderId, o]));
  const entriesByOrder = groupBy(snapshot.earningEntries, (e) => e.orderId);
  return snapshot.earningOrders.flatMap((earning) => {
    const record = { orderId: earning.orderId };
    const problems: string[] = [];
    const entries = entriesByOrder.get(earning.orderId) ?? [];
    const refunds = entries.filter((e) => e.kind === 'refund');
    const refunded = sum(refunds, 'refundMinor');
    if (refunded !== earning.refundedMinor) {
      problems.push(
        `refund entries add up to ${refunded}, but refundedMinor is ${earning.refundedMinor}`,
      );
    }
    if (earning.refundedMinor > earning.paidMinor) {
      problems.push(
        `refundedMinor ${earning.refundedMinor} exceeds paidMinor ${earning.paidMinor}`,
      );
    }
    const order = orders.get(earning.orderId);
    if (order && earning.refundedMinor > (order.refundedAmount ?? 0)) {
      problems.push(
        `refundedMinor ${earning.refundedMinor} exceeds the order's refundedAmount ${order.refundedAmount ?? 0}`,
      );
    }
    const full = earning.refundedMinor === earning.paidMinor;
    const salesBy = groupBy(
      entries.filter((e) => e.kind === 'sale'),
      (e) => e.instructorId,
    );
    for (const [instructorId, refundList] of groupBy(
      refunds,
      (e) => e.instructorId,
    )) {
      const sale = salesBy.get(instructorId)?.[0];
      if (!sale) continue;
      const fee = 0 - sum(refundList, 'feeMinor');
      const net = 0 - sum(refundList, 'netMinor');
      if (fee > sale.feeMinor) {
        problems.push(
          `${instructorId} gives back fee ${fee}, more than the sale's ${sale.feeMinor}`,
        );
      }
      if (net > sale.netMinor) {
        problems.push(
          `${instructorId} gives back net ${net}, more than the sale's ${sale.netMinor}`,
        );
      }
    }
    if (full) {
      for (const [instructorId, saleList] of salesBy) {
        const refundList = refunds.filter(
          (e) => e.instructorId === instructorId,
        );
        const fee = 0 - sum(refundList, 'feeMinor');
        const net = 0 - sum(refundList, 'netMinor');
        if (fee !== saleList[0].feeMinor || net !== saleList[0].netMinor) {
          problems.push(
            `${instructorId} is fully refunded, but gives back fee ${fee} and net ${net}, not the sale's ${saleList[0].feeMinor} and ${saleList[0].netMinor}`,
          );
        }
      }
    }
    return problems.map((message) =>
      violation('earning-refunds-capped', record, message),
    );
  });
};

// Each day row equals the sum of its entries (sales, gross, discount, refund,
// fee, net), and every entry has a row.
export const checkEarningDayMatchesEntries = (
  snapshot: TableSnapshot,
): Violation[] => {
  const dayKey = (r: {
    instructorId: string;
    day: string;
    courseId: string;
    currency: string;
  }) => JSON.stringify([r.instructorId, r.day, r.courseId, r.currency]);
  const rows = new Map(snapshot.earningDays.map((d) => [dayKey(d), d]));
  const groups = groupBy(snapshot.earningEntries, (e) =>
    dayKey({ ...e, day: dayOf(e.occurredAt) }),
  );
  const figures = [
    ['grossMinor', 'grossMinor'],
    ['discountMinor', 'discountMinor'],
    ['refundMinor', 'refundMinor'],
    ['feeMinor', 'feeMinor'],
    ['netMinor', 'netMinor'],
  ] as const;
  const keyOf = (r: {
    instructorId: string;
    day: string;
    courseId: string;
    currency: string;
  }) => ({
    instructorId: r.instructorId,
    day: r.day,
    courseId: r.courseId,
    currency: r.currency,
  });

  const missing = [...groups].flatMap(([key, entries]) =>
    rows.has(key)
      ? []
      : [
          violation(
            'earning-day-matches-entries',
            keyOf({ ...entries[0], day: dayOf(entries[0].occurredAt) }),
            'has entries, but no day row',
          ),
        ],
  );
  const differing = snapshot.earningDays.flatMap((row) => {
    const entries = groups.get(dayKey(row)) ?? [];
    const problems: string[] = [];
    const sales = entries.filter((e) => e.kind === 'sale').length;
    if ((row.salesCount ?? 0) !== sales) {
      problems.push(`salesCount ${row.salesCount ?? 0} is not ${sales}`);
    }
    for (const [rowField, entryField] of figures) {
      const expected = sum(entries, entryField);
      if ((row[rowField] ?? 0) !== expected) {
        problems.push(
          `${rowField} ${row[rowField] ?? 0} is not the entries' ${expected}`,
        );
      }
    }
    return problems.map((message) =>
      violation('earning-day-matches-entries', keyOf(row), message),
    );
  });
  return [...missing, ...differing];
};

// An entry's payoutId names a payout of the same instructor, currency and
// payment account, and its settlement key agrees; a payout's amount and count
// equal its entries'; a sent or pending payout is above 0; a transfer ID is
// there exactly when sent; a failed payout has a reason and owns nothing.
export const checkPayoutMatchesEntries = (
  snapshot: TableSnapshot,
): Violation[] => {
  const payouts = new Map(snapshot.payouts.map((p) => [p.payoutId, p]));
  const owned = groupBy(
    snapshot.earningEntries.filter((e) => e.payoutId !== undefined),
    (e) => e.payoutId,
  );

  const entryProblems = snapshot.earningEntries.flatMap((entry) => {
    const problems: string[] = [];
    const expected = entry.payoutId
      ? `payout#${entry.payoutId}`
      : `open#${entry.instructorId}`;
    if (entry.settlement !== expected) {
      problems.push(`settlement ${entry.settlement} is not ${expected}`);
    }
    if (entry.payoutId !== undefined) {
      const payout = payouts.get(entry.payoutId);
      if (!payout) {
        problems.push(`payoutId ${entry.payoutId} names no payout`);
      } else {
        for (const field of [
          'instructorId',
          'currency',
          'accountId',
          'mode',
        ] as const) {
          if (payout[field] !== entry[field]) {
            problems.push(
              `payout ${payout.payoutId} has ${field} ${payout[field]}, the entry ${entry[field]}`,
            );
          }
        }
      }
    }
    return problems.map((message) =>
      violation('payout-matches-entries', entryKey(entry), message),
    );
  });

  const payoutProblems = snapshot.payouts.flatMap((payout) => {
    const record = {
      instructorId: payout.instructorId,
      payoutId: payout.payoutId,
    };
    const problems: string[] = [];
    const entries = owned.get(payout.payoutId) ?? [];
    if (['collecting', 'pending', 'sent'].includes(payout.status)) {
      const net = sum(entries, 'netMinor');
      if (payout.amountMinor !== net) {
        problems.push(
          `amountMinor ${payout.amountMinor} is not its entries' net ${net}`,
        );
      }
      if (payout.entryCount !== entries.length) {
        problems.push(
          `entryCount ${payout.entryCount} is not its ${entries.length} entries`,
        );
      }
    }
    if (
      (payout.status === 'pending' || payout.status === 'sent') &&
      !(payout.amountMinor > 0)
    ) {
      problems.push(
        `${payout.status}, but amountMinor ${payout.amountMinor} is not above 0`,
      );
    }
    if (payout.status === 'sent' && !payout.transferId) {
      problems.push('sent, but there is no transfer ID');
    }
    if (payout.status !== 'sent' && payout.transferId) {
      problems.push(`${payout.status}, but a transfer ID is set`);
    }
    if (payout.status === 'failed') {
      if (!payout.failureReason)
        problems.push('failed, but there is no reason');
      if (entries.length > 0) {
        problems.push(`failed, but it still owns ${entries.length} entries`);
      }
    }
    return problems.map((message) =>
      violation('payout-matches-entries', record, message),
    );
  });
  return [...entryProblems, ...payoutProblems];
};

// At most one payout account per instructor and payment account, a known
// status, a connected account, and an instructor that has a user record.
export const checkPayoutAccountShape = (
  snapshot: TableSnapshot,
): Violation[] => {
  const users = new Set(snapshot.users.map((u) => u.userId));
  const counts = groupBy(snapshot.payoutAccounts, (a) =>
    JSON.stringify([a.instructorId, a.accountId, a.mode]),
  );
  return snapshot.payoutAccounts.flatMap((account) => {
    const problems: string[] = [];
    const same =
      counts.get(
        JSON.stringify([account.instructorId, account.accountId, account.mode]),
      )?.length ?? 0;
    if (same > 1) {
      problems.push(`${same} accounts for this instructor and payment account`);
    }
    if (
      !(PAYOUT_ACCOUNT_STATUSES as readonly string[]).includes(account.status)
    ) {
      problems.push(`status ${account.status} is not known`);
    }
    if (!account.connectedAccountId)
      problems.push('connectedAccountId is not set');
    if (!users.has(account.instructorId)) {
      problems.push('the instructor has no user record');
    }
    return problems.map((message) =>
      violation(
        'payout-account-shape',
        {
          instructorId: account.instructorId,
          accountId: account.accountId,
          mode: account.mode,
        },
        message,
      ),
    );
  });
};

export const EARNINGS_CHECKS = [
  { name: 'earning-identity', check: checkEarningIdentity },
  { name: 'earning-matches-order', check: checkEarningMatchesOrder },
  { name: 'earning-refunds-capped', check: checkEarningRefundsCapped },
  { name: 'earning-day-matches-entries', check: checkEarningDayMatchesEntries },
  { name: 'payout-matches-entries', check: checkPayoutMatchesEntries },
  { name: 'payout-account-shape', check: checkPayoutAccountShape },
] as const satisfies readonly Check[];
