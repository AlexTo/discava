/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { v7 as uuidv7 } from 'uuid';
import { openSettlement, payoutSettlement } from '../entities/earning-entry.js';
import type { PaymentMode } from '../entities/payment-connection.js';
import type { PayoutStatus } from '../entities/payout.js';
import type { PayoutAccountStatus } from '../entities/payout-account.js';
import type { createCoreTableService } from '../service.js';
import type { EarningEntryRecord } from './earning.js';
import { isConditionalCheckFailed } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `payout` and `payoutAccount`, and the only code that
// sets or clears an earning entry's `payoutId` (data-model.md "Lifecycle",
// research R-7). A transaction holds at most 100 items and an instructor can
// have more released entries than that, so a payout collects its entries in
// batches and is only sealed (`pending`) when every one is attached. None of
// it calls Stripe: the caller does that between sealing and marking sent.

/** Entries attached per transaction: 99 entries and the payout. */
export const PAYOUT_BATCH_SIZE = 99;

/** Entries cleared per transaction when a payout is released. */
const RELEASE_BATCH_SIZE = 100;

/** Entries cleared at once when the caller names them. */
const CLEAR_PARALLEL = 25;

/** A payout a run worked on this recently is still that run's. */
export const PAYOUT_CLAIM_GRACE_MS = 15 * 60 * 1000;

const UNSETTLED_STATUSES = ['collecting', 'releasing', 'pending'] as const;

export interface PayoutAccountRecord {
  instructorId: string;
  accountId: string;
  mode: PaymentMode;
  connectedAccountId: string;
  status: PayoutAccountStatus;
}

export interface PayoutRecord {
  instructorId: string;
  payoutId: string;
  accountId: string;
  mode: PaymentMode;
  currency: string;
  status: PayoutStatus;
  amountMinor: number;
  entryCount: number;
  attemptedAt: string;
  connectedAccountId: string;
  transferId?: string;
  failureReason?: string;
  createdAt: string;
  settledAt?: string;
}

const payoutKey = ({
  instructorId,
  createdAt,
  payoutId,
}: Pick<PayoutRecord, 'instructorId' | 'createdAt' | 'payoutId'>) => ({
  instructorId,
  createdAt,
  payoutId,
});

const entryKey = ({
  instructorId,
  courseId,
  occurredAt,
  entryId,
}: Pick<
  EarningEntryRecord,
  'instructorId' | 'courseId' | 'occurredAt' | 'entryId'
>) => ({ instructorId, courseId, occurredAt, entryId });

/**
 * Stores what Stripe says of an instructor's connected account: creates the
 * record the first time, afterwards only moves its status.
 */
export const saveAccountStatus = async ({
  coreTable,
  instructorId,
  accountId,
  mode,
  connectedAccountId,
  status,
}: PayoutAccountRecord & {
  coreTable: CoreTable;
}): Promise<PayoutAccountRecord> => {
  const record = { instructorId, accountId, mode, connectedAccountId, status };
  try {
    await coreTable.entities.payoutAccount.create(record).go();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    await coreTable.entities.payoutAccount
      .patch({ instructorId, accountId, mode })
      .set({ status })
      .go();
  }
  return record;
};

/** The instructors with an active payout account under a payment account. */
export const listActiveAccounts = async ({
  coreTable,
  accountId,
  mode,
}: {
  coreTable: CoreTable;
  accountId: string;
  mode: PaymentMode;
}): Promise<PayoutAccountRecord[]> => {
  const { data } = await coreTable.entities.payoutAccount.query
    .byStatus({ accountId, mode, status: 'active' })
    .go({ pages: 'all' });
  return data as PayoutAccountRecord[];
};

/**
 * Every entry of an instructor that no payout has taken, oldest release
 * first, read to the end. The payment account and release time are filtered
 * by the caller.
 */
export const openEntries = async ({
  coreTable,
  instructorId,
}: {
  coreTable: CoreTable;
  instructorId: string;
}): Promise<EarningEntryRecord[]> => {
  const { data } = await coreTable.entities.earningEntry.query
    .bySettlement({ settlement: openSettlement(instructorId) })
    .go({ pages: 'all' });
  return data as EarningEntryRecord[];
};

const getPayout = async (coreTable: CoreTable, payout: PayoutRecord) =>
  (await coreTable.entities.payout.get(payoutKey(payout)).go())
    .data as PayoutRecord | null;

/**
 * Creates a payout of the given entries (all the instructor's, in one
 * currency, of one payment account, released and open). It is created
 * `collecting`, the entries are attached in batches of up to 99 (each batch
 * one transaction: every entry's `payoutId` set on the condition that it has
 * none, and the payout's amount and count raised on the condition that it is
 * still `collecting`), and it is then sealed `pending` and returned. When a
 * batch loses an entry to another payout the payout is released and nothing
 * is returned, as it is for no entries or a net that is not above 0.
 */
export const createPayout = async ({
  coreTable,
  instructorId,
  accountId,
  mode,
  currency,
  connectedAccountId,
  entries,
  now,
}: {
  coreTable: CoreTable;
  instructorId: string;
  accountId: string;
  mode: PaymentMode;
  currency: string;
  connectedAccountId: string;
  entries: EarningEntryRecord[];
  now: string;
}): Promise<PayoutRecord | undefined> => {
  const total = entries.reduce((sum, entry) => sum + entry.netMinor, 0);
  if (entries.length === 0 || total <= 0) return undefined;

  const payout: PayoutRecord = {
    instructorId,
    payoutId: uuidv7(),
    accountId,
    mode,
    currency,
    status: 'collecting',
    amountMinor: 0,
    entryCount: 0,
    attemptedAt: now,
    connectedAccountId,
    createdAt: now,
  };
  await coreTable.entities.payout.create(payout).go();

  for (let start = 0; start < entries.length; start += PAYOUT_BATCH_SIZE) {
    const batch = entries.slice(start, start + PAYOUT_BATCH_SIZE);
    const { canceled } = await coreTable.transaction
      .write(({ earningEntry, payout: payouts }) => [
        ...batch.map((entry) =>
          earningEntry
            .patch(entryKey(entry))
            .set({ payoutId: payout.payoutId })
            .where((attr, op) => op.notExists(attr.payoutId))
            .commit(),
        ),
        payouts
          .patch(payoutKey(payout))
          .add({
            amountMinor: batch.reduce((sum, entry) => sum + entry.netMinor, 0),
            entryCount: batch.length,
          })
          .where((attr, op) => op.eq(attr.status, 'collecting'))
          .commit(),
      ])
      .go();
    if (canceled) {
      await releasePayout({ coreTable, payout, entries, now });
      return undefined;
    }
  }

  try {
    await coreTable.entities.payout
      .patch(payoutKey(payout))
      .set({ status: 'pending' })
      .where((attr, op) => op.eq(attr.status, 'collecting'))
      .go();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    await releasePayout({ coreTable, payout, entries, now });
    return undefined;
  }
  return {
    ...payout,
    status: 'pending',
    amountMinor: total,
    entryCount: entries.length,
  };
};

// Makes an entry open again if this payout holds it; one it never took, or
// that another payout took, is left alone.
const clearEntry = async (
  coreTable: CoreTable,
  entry: EarningEntryRecord,
  payoutId: string,
) => {
  try {
    await coreTable.entities.earningEntry
      .patch(entryKey(entry))
      .set({ settlement: openSettlement(entry.instructorId) })
      .remove(['payoutId'])
      .where((attr, op) => op.eq(attr.payoutId, payoutId))
      .go();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
  }
};

/**
 * Finishes a payout that will not be paid: a `collecting` one is moved to
 * `releasing` (conditionally), its entries' `payoutId` are cleared in
 * batches until none are left, and it is then marked `failed` when it has a
 * `failureReason` and deleted when it has not. Safe to call again at any
 * point, and a no-op for a payout that is `pending`, `sent` or `failed`.
 *
 * Entries are found through `gsi1pk-gsi1sk-index`, which DynamoDB updates
 * eventually, so an empty page right after they were attached proves nothing.
 * A caller that has just attached entries passes them as `entries`: each one
 * the payout still holds is cleared by a direct, consistent write before the
 * index is swept for the rest (recovery, long after the writes).
 */
export const releasePayout = async ({
  coreTable,
  payout,
  entries = [],
  now = new Date().toISOString(),
}: {
  coreTable: CoreTable;
  payout: Pick<PayoutRecord, 'instructorId' | 'createdAt' | 'payoutId'>;
  /** Entries the caller attached, whether or not the index shows them yet. */
  entries?: EarningEntryRecord[];
  now?: string;
}): Promise<void> => {
  const key = payoutKey(payout);
  let current = await getPayout(coreTable, payout as PayoutRecord);
  if (!current) return;
  if (current.status === 'collecting') {
    try {
      await coreTable.entities.payout
        .patch(key)
        .set({ status: 'releasing' })
        .where((attr, op) => op.eq(attr.status, 'collecting'))
        .go();
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
    }
    current = await getPayout(coreTable, payout as PayoutRecord);
    if (!current) return;
  }
  if (current.status !== 'releasing') return;

  for (let start = 0; start < entries.length; start += CLEAR_PARALLEL) {
    await Promise.all(
      entries
        .slice(start, start + CLEAR_PARALLEL)
        .map((entry) => clearEntry(coreTable, entry, current!.payoutId)),
    );
  }

  for (;;) {
    const { data } = await coreTable.entities.earningEntry.query
      .bySettlement({ settlement: payoutSettlement(current.payoutId) })
      .go({ limit: RELEASE_BATCH_SIZE });
    const owned = data as EarningEntryRecord[];
    if (owned.length === 0) break;
    await coreTable.transaction
      .write(({ earningEntry }) =>
        owned.map((entry) =>
          earningEntry
            .patch(entryKey(entry))
            .set({ settlement: openSettlement(entry.instructorId) })
            .remove(['payoutId'])
            .where((attr, op) => op.eq(attr.payoutId, current!.payoutId))
            .commit(),
        ),
      )
      .go();
  }

  try {
    if (current.failureReason) {
      await coreTable.entities.payout
        .patch(key)
        .set({ status: 'failed', settledAt: now })
        .where((attr, op) => op.eq(attr.status, 'releasing'))
        .go();
    } else {
      await coreTable.entities.payout
        .delete(key)
        .where((attr, op) => op.eq(attr.status, 'releasing'))
        .go();
    }
  } catch (error) {
    // Another call finished it first.
    if (!isConditionalCheckFailed(error)) throw error;
  }
};

/** Marks a `pending` payout `sent`, storing its transfer; false if it is not pending. */
export const markPayoutSent = async ({
  coreTable,
  payout,
  transferId,
  now,
}: {
  coreTable: CoreTable;
  payout: PayoutRecord;
  transferId: string;
  now: string;
}): Promise<boolean> => {
  try {
    await coreTable.entities.payout
      .patch(payoutKey(payout))
      .set({ status: 'sent', transferId, settledAt: now })
      .where((attr, op) => op.eq(attr.status, 'pending'))
      .go();
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
};

/**
 * Marks a `pending` payout whose transfer Stripe definitely rejected as
 * `releasing` with the reason, then releases it: its entries are open again
 * and it stays as `failed`. False, with nothing changed, if it is not pending.
 */
export const markPayoutFailed = async ({
  coreTable,
  payout,
  reason,
  now,
}: {
  coreTable: CoreTable;
  payout: PayoutRecord;
  reason: string;
  now: string;
}): Promise<boolean> => {
  try {
    await coreTable.entities.payout
      .patch(payoutKey(payout))
      .set({ status: 'releasing', failureReason: reason })
      .where((attr, op) => op.eq(attr.status, 'pending'))
      .go();
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
  await releasePayout({ coreTable, payout, now });
  return true;
};

/**
 * The payouts that have not settled, of every instructor whatever the state
 * of their account: `collecting` and `releasing` ones to finish, `pending`
 * ones whose transfer may or may not exist. Sent and failed ones are not
 * here.
 */
export const listUnsettledPayouts = async ({
  coreTable,
}: {
  coreTable: CoreTable;
}): Promise<PayoutRecord[]> => {
  const partitions = await Promise.all(
    UNSETTLED_STATUSES.map((status) =>
      coreTable.entities.payout.query
        .payoutsByStatus({ status })
        .go({ pages: 'all' }),
    ),
  );
  return partitions.flatMap(({ data }) => data as PayoutRecord[]);
};

/**
 * Takes an unsettled payout for this run: moves its `attemptedAt` to `now`
 * on the condition that it still holds the value read, so of two overlapping
 * runs one wins. False if another run claimed it, or if it was attempted
 * within `PAYOUT_CLAIM_GRACE_MS` and so is still that run's.
 */
export const claimPayout = async ({
  coreTable,
  payout,
  now,
}: {
  coreTable: CoreTable;
  payout: PayoutRecord;
  now: string;
}): Promise<boolean> => {
  if (
    new Date(now).getTime() - new Date(payout.attemptedAt).getTime() <
    PAYOUT_CLAIM_GRACE_MS
  ) {
    return false;
  }
  try {
    await coreTable.entities.payout
      .patch(payoutKey(payout))
      .set({ attemptedAt: now })
      .where(
        (attr, op) =>
          `${op.eq(attr.attemptedAt, payout.attemptedAt)} AND ${op.eq(attr.status, payout.status)}`,
      )
      .go();
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
};
