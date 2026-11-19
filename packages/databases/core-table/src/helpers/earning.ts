/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PaymentMode } from '../entities/payment-connection.js';
import type { createCoreTableService } from '../service.js';
import {
  cancellationReasons,
  hasFailedCondition,
  hasTransactionConflict,
} from './errors.js';
import {
  calculateFee,
  calculateRefund,
  calculateSale,
  type InstructorRefund,
  type InstructorSale,
} from './revenue.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;
type TransactionEntities = Parameters<
  Parameters<CoreTable['transaction']['write']>[0]
>[0];

// The only writer of `earningEntry`, `earningDay` and `earningOrder`. A sale
// and every refund step is one DynamoDB transaction holding the entries, the
// day rows they add to and the order's counter, so the report and the ledger
// never disagree (research R-3). Verb-named, so each runs its own I/O.

/** How often a refund retries after another refund of the order won the race. */
const REFUND_ATTEMPTS = 5;

/** How often a sale retries after a write conflict on its day row. */
const SALE_ATTEMPTS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a sale needs from the `order` record. */
export interface EarningSaleOrder {
  orderId: string;
  courseId: string;
  accountId: string;
  mode: PaymentMode;
  currency: string;
  listAmount: number;
  amount: number;
  paidAt: string;
}

/** The ledger's snapshot of a sale, as `earningOrder` stores it. */
export interface EarningOrderRecord {
  orderId: string;
  courseId: string;
  currency: string;
  accountId: string;
  mode: PaymentMode;
  grossMinor: number;
  discountMinor: number;
  paidMinor: number;
  feeMinor: number;
  feeBasisPoints: number;
  instructorIds: string[];
  refundedMinor: number;
}

export interface EarningDayRecord {
  instructorId: string;
  courseId: string;
  currency: string;
  day: string;
  salesCount?: number;
  grossMinor?: number;
  discountMinor?: number;
  refundMinor?: number;
  feeMinor?: number;
  netMinor?: number;
}

export interface EarningEntryRecord {
  instructorId: string;
  courseId: string;
  orderId: string;
  accountId: string;
  mode: PaymentMode;
  entryId: string;
  kind: 'sale' | 'refund';
  currency: string;
  grossMinor: number;
  discountMinor: number;
  refundMinor: number;
  feeMinor: number;
  netMinor: number;
  feeBasisPoints: number;
  occurredAt: string;
  releaseAt: string;
  payoutId?: string;
}

const plusDays = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();

/** The UTC day, `YYYY-MM-DD`, an instant falls on. */
export const earningDayOf = (iso: string) =>
  new Date(iso).toISOString().slice(0, 10);

type EntryContext = Pick<
  EarningEntryRecord,
  | 'courseId'
  | 'orderId'
  | 'accountId'
  | 'mode'
  | 'currency'
  | 'feeBasisPoints'
  | 'occurredAt'
  | 'releaseAt'
>;

// One entry and the add to its day row, which a transaction holds for each
// instructor. The entry is conditioned on its key not existing.
const entryWrites = (
  { earningEntry, earningDay }: TransactionEntities,
  entry: EarningEntryRecord,
  sale: boolean,
) => [
  earningEntry.create(entry).commit(),
  earningDay
    .update({
      instructorId: entry.instructorId,
      day: earningDayOf(entry.occurredAt),
      courseId: entry.courseId,
      currency: entry.currency,
    })
    .add({
      salesCount: sale ? 1 : 0,
      grossMinor: entry.grossMinor,
      discountMinor: entry.discountMinor,
      refundMinor: entry.refundMinor,
      feeMinor: entry.feeMinor,
      netMinor: entry.netMinor,
    })
    .commit(),
];

const saleEntry = (
  context: EntryContext,
  { instructorId, ...figures }: InstructorSale,
): EarningEntryRecord => ({
  ...context,
  instructorId,
  entryId: `sale-${context.orderId}`,
  kind: 'sale',
  grossMinor: figures.grossMinor,
  discountMinor: figures.discountMinor,
  refundMinor: 0,
  feeMinor: figures.feeMinor,
  netMinor: figures.netMinor,
});

const refundEntry = (
  context: EntryContext,
  refundedTotal: number,
  { instructorId, refundMinor, feeMinor, netMinor }: InstructorRefund,
): EarningEntryRecord => ({
  ...context,
  instructorId,
  entryId: `refund-${context.orderId}-${refundedTotal}`,
  kind: 'refund',
  grossMinor: 0,
  discountMinor: 0,
  refundMinor,
  feeMinor,
  netMinor,
});

/**
 * Records a sale: the order's `earningOrder` and each instructor's sale
 * entry, each created on the condition that it does not exist, and the adds
 * to their day rows, in one transaction. A sale already recorded (or being
 * recorded by a racing call) changes nothing and returns false. A write
 * conflict with another transaction is retried up to 5 times, then throws so
 * the queue redelivers; it is never taken for "already recorded".
 */
export const recordSale = async ({
  coreTable,
  order,
  instructorIds,
  feeBasisPoints,
  holdDays,
}: {
  coreTable: CoreTable;
  order: EarningSaleOrder;
  instructorIds: readonly string[];
  feeBasisPoints: number;
  holdDays: number;
}): Promise<boolean> => {
  if (order.amount <= 0) throw new RangeError('A sale needs an amount above 0');
  const shares = calculateSale({
    grossMinor: order.listAmount,
    paidMinor: order.amount,
    feeBasisPoints,
    instructorIds,
  });
  const context: EntryContext = {
    courseId: order.courseId,
    orderId: order.orderId,
    accountId: order.accountId,
    mode: order.mode,
    currency: order.currency,
    feeBasisPoints,
    occurredAt: order.paidAt,
    releaseAt: plusDays(order.paidAt, holdDays),
  };
  const snapshot: EarningOrderRecord = {
    orderId: order.orderId,
    courseId: order.courseId,
    currency: order.currency,
    accountId: order.accountId,
    mode: order.mode,
    grossMinor: order.listAmount,
    discountMinor: order.listAmount - order.amount,
    paidMinor: order.amount,
    feeMinor: calculateFee(order.amount, feeBasisPoints),
    feeBasisPoints,
    instructorIds: shares.map((share) => share.instructorId),
    refundedMinor: 0,
  };
  for (let attempt = 0; attempt < SALE_ATTEMPTS; attempt++) {
    const { canceled, data } = await coreTable.transaction
      .write((entities) => [
        entities.earningOrder.create(snapshot).commit(),
        ...shares.flatMap((share) =>
          entryWrites(entities, saleEntry(context, share), true),
        ),
      ])
      .go();
    if (!canceled) return true;
    // A key that already exists means the sale is recorded.
    if (hasFailedCondition(cancellationReasons(data))) return false;
    // Two sales of one instructor, course and day add to one day row, and
    // DynamoDB cancels one with TransactionConflict. Nothing was written, so
    // it is tried again rather than taken for "already recorded".
    if (!hasTransactionConflict(data)) {
      throw new Error(`Could not record the sale of order ${order.orderId}`);
    }
  }
  throw new Error(
    `Could not record the sale of order ${order.orderId}; try again`,
  );
};

/**
 * Brings the ledger's refunded total for an order up to `refundedTotal`
 * (capped at the amount paid): the refund entries for the step from what is
 * recorded, their adds to the day rows and the new total, in one transaction
 * conditioned on the total still being the one the shares were computed
 * from. When another refund of the order got there first it reads again and
 * recomputes, up to 5 times, then throws so the queue redelivers. A total the
 * ledger has already reached, and an order with no earnings, record nothing
 * (false). `occurredAt` is when the refund happened, never "now".
 */
export const recordRefund = async ({
  coreTable,
  orderId,
  refundedTotal,
  occurredAt,
}: {
  coreTable: CoreTable;
  orderId: string;
  refundedTotal: number;
  occurredAt: string;
}): Promise<boolean> => {
  for (let attempt = 0; attempt < REFUND_ATTEMPTS; attempt++) {
    const { data } = await coreTable.entities.earningOrder
      .get({ orderId })
      .go();
    if (!data) return false;
    const earning = data as EarningOrderRecord;
    const recorded = earning.refundedMinor;
    const total = Math.min(refundedTotal, earning.paidMinor);
    if (total <= recorded) return false;

    const shares = calculateRefund({
      grossMinor: earning.grossMinor,
      paidMinor: earning.paidMinor,
      feeBasisPoints: earning.feeBasisPoints,
      instructorIds: earning.instructorIds,
      recordedRefundedMinor: recorded,
      refundedTotalMinor: total,
    });
    const context: EntryContext = {
      courseId: earning.courseId,
      orderId,
      accountId: earning.accountId,
      mode: earning.mode,
      currency: earning.currency,
      feeBasisPoints: earning.feeBasisPoints,
      occurredAt,
      releaseAt: occurredAt,
    };
    const { canceled } = await coreTable.transaction
      .write((entities) => [
        entities.earningOrder
          .patch({ orderId })
          .set({ refundedMinor: total })
          .where((attr, op) => op.eq(attr.refundedMinor, recorded))
          .commit(),
        ...shares.flatMap((share) =>
          entryWrites(entities, refundEntry(context, total, share), false),
        ),
      ])
      .go();
    if (!canceled) return true;
  }
  throw new Error(`Could not record the refund of order ${orderId}; try again`);
};

/**
 * An instructor's day rows from `from` to `to`, both `YYYY-MM-DD` and
 * inclusive: one range query on the `D#` keys.
 */
export const queryEarningDays = async ({
  coreTable,
  instructorId,
  from,
  to,
}: {
  coreTable: CoreTable;
  instructorId: string;
  from: string;
  to: string;
}): Promise<EarningDayRecord[]> => {
  // `~` sorts after `#`, so the end bound takes in every row of the last day.
  const { data } = await coreTable.entities.earningDay.query
    .primary({ instructorId })
    .between({ day: from }, { day: `${to}~` })
    .go({ pages: 'all' });
  return data as EarningDayRecord[];
};

/**
 * One page of an instructor's entries for a course from `from` to `to`
 * (`YYYY-MM-DD`, inclusive), oldest first: a range under `L#<courseId>#`.
 * Pass the returned `cursor` to read the next page; it is null on the last.
 */
export const queryEarningLines = async ({
  coreTable,
  instructorId,
  courseId,
  from,
  to,
  cursor,
  limit,
}: {
  coreTable: CoreTable;
  instructorId: string;
  courseId: string;
  from: string;
  to: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ lines: EarningEntryRecord[]; cursor: string | null }> => {
  const { data, cursor: next } = await coreTable.entities.earningEntry.query
    .primary({ instructorId })
    .between({ courseId, occurredAt: from }, { courseId, occurredAt: `${to}~` })
    .go({ cursor: cursor ?? undefined, limit });
  return { lines: data as EarningEntryRecord[], cursor: next ?? null };
};
