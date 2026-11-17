/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { createCoreTableService } from '../service.js';
import type { Delta, Member } from './analytics.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// How long a marker outlives what it guards: the failure queue keeps a
// message for 14 days, so a change can be delivered again until then.
const MARKER_GRACE_DAYS = 15;
const DAY_MS = 86_400_000;

export interface AnalyticsChange {
  /** The stream record's eventID: the key of the change's marker. */
  eventId: string;
  courseId: string;
  counts: Delta[];
  members: Member[];
  now?: Date;
}

export type AnalyticsChangeResult = 'applied' | 'already-applied';

const epochSeconds = (ms: number) => Math.floor(ms / 1000);

/** When a day or week ends, as epoch milliseconds (UTC). */
const periodEnd = (period: string): number => {
  const [kind, value] = period.split('#');
  if (kind === 'DAY') {
    return Date.parse(`${value}T00:00:00.000Z`) + DAY_MS;
  }
  // `<yyyy>-W<ww>`: week 1 is the week holding January 4th.
  const [year, week] = value.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS;
  return week1Monday + week * 7 * DAY_MS;
};

const isCancelled = (
  reasons: ({ code?: string } | undefined)[] | undefined,
  index: number,
) => reasons?.[index]?.code === 'ConditionalCheckFailed';

// The deltas grouped by the item they change, as a transaction may name an
// item only once.
const byItem = (counts: Delta[]) => {
  const items = new Map<string, Delta[]>();
  for (const delta of counts) {
    const key = `${delta.kind} ${delta.sk}`;
    items.set(key, [...(items.get(key) ?? []), delta]);
  }
  return [...items.values()];
};

const counters = (deltas: Delta[]) =>
  Object.fromEntries(
    deltas.map(({ attribute, amount }) => [attribute, amount]),
  );

type TransactionWrites = Parameters<CoreTable['transaction']['write']>[0];
type Entities = Parameters<TransactionWrites>[0];

// The update of one aggregate item that adds the deltas to its counters. Only
// ever `add`, so concurrent and reordered updates all count. `updatedAt` is
// the summary's "last updated".
const itemUpdate = (
  { courseStats, periodStats }: Entities,
  courseId: string,
  deltas: Delta[],
  now: Date,
) => {
  const [{ kind, sk }] = deltas;
  if (kind === 'courseStats') {
    return courseStats
      .update({ courseId })
      .add(counters(deltas))
      .set({ updatedAt: now.toISOString() })
      .commit();
  }
  return periodStats
    .update({ courseId, periodKey: sk })
    .add(counters(deltas))
    .set({ period: sk.startsWith('DAY#') ? 'day' : 'week' })
    .commit();
};

// DynamoDB cancels one of two transactions that touch an item at the same
// moment with TransactionConflict, not a failed condition. Every change of a
// course touches its summary, so batches running in parallel meet here; it
// clears in milliseconds, so the transaction is tried again a few times
// before the failure is left to the batch's retry.
const CONFLICT_ATTEMPTS = 5;
const CONFLICT_BACKOFF_MS = 50;

const hasConflict = (reasons: ({ code?: string } | undefined)[] | undefined) =>
  reasons?.some((reason) => reason?.code === 'TransactionConflict') ?? false;

// Runs a transaction whose first write is a marker, and says whether it was
// applied (true) or its marker was already there (false). Anything else
// cancelling it is thrown.
const writeOnce = async (
  coreTable: CoreTable,
  writes: TransactionWrites,
  what: string,
): Promise<boolean> => {
  for (let attempt = 1; ; attempt++) {
    const { canceled, data } = await coreTable.transaction.write(writes).go();
    if (!canceled) {
      return true;
    }
    if (isCancelled(data, 0)) {
      return false;
    }
    if (!hasConflict(data) || attempt === CONFLICT_ATTEMPTS) {
      throw new Error(
        `Analytics transaction for ${what} was cancelled: ${JSON.stringify(data)}`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, CONFLICT_BACKOFF_MS * attempt),
    );
  }
};

/**
 * Applies one stream change to the aggregates, once. Its counts and an
 * `EVENT#<eventID>` marker are written in one transaction, and the marker's
 * condition cancels the transaction when the change was applied already, so a
 * redelivered record counts nothing more. Each member (a learner active in a
 * day or week) is a transaction of its own, with a `MEMBER#<period>#<userId>`
 * marker, so a learner's second record in a period counts nothing, whatever
 * event brought it. A cancelled part never cancels the others. Any other
 * failure, or a conflict that does not clear, is thrown, for the batch to be retried from the queue.
 */
export const applyAnalyticsChange = async (
  coreTable: CoreTable,
  { eventId, courseId, counts, members, now = new Date() }: AnalyticsChange,
): Promise<AnalyticsChangeResult> => {
  let result: AnalyticsChangeResult = 'already-applied';

  if (counts.length > 0) {
    const ttl = epochSeconds(now.getTime() + MARKER_GRACE_DAYS * DAY_MS);
    const applied = await writeOnce(
      coreTable,
      (entities) => [
        entities.analyticsMarker
          .create({ courseId, markerId: `EVENT#${eventId}`, ttl })
          .commit(),
        ...byItem(counts).map((deltas) =>
          itemUpdate(entities, courseId, deltas, now),
        ),
      ],
      `event ${eventId}`,
    );
    if (applied) {
      result = 'applied';
    }
  }

  for (const { period, userId } of members) {
    const ttl = epochSeconds(periodEnd(period) + MARKER_GRACE_DAYS * DAY_MS);
    const applied = await writeOnce(
      coreTable,
      (entities) => [
        entities.analyticsMarker
          .create({ courseId, markerId: `MEMBER#${period}#${userId}`, ttl })
          .commit(),
        itemUpdate(
          entities,
          courseId,
          [
            {
              kind: 'periodStats',
              courseId,
              sk: period,
              attribute: 'activeLearners',
              amount: 1,
            },
          ],
          now,
        ),
        // Activity is something that happened, so the summary was updated.
        entities.courseStats
          .update({ courseId })
          .set({ updatedAt: now.toISOString() })
          .commit(),
      ],
      `${userId} in ${period}`,
    );
    if (applied) {
      result = 'applied';
    }
  }
  return result;
};
