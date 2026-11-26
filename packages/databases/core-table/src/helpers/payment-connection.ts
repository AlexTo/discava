/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { v7 as uuidv7 } from 'uuid';
import type {
  PaymentChangeKind,
  PaymentChangeStep,
} from '../entities/payment-change.js';
import type {
  PaymentConnectionStatus,
  PaymentMode,
} from '../entities/payment-connection.js';
import type { createCoreTableService } from '../service.js';
import { isConditionalCheckFailed } from './errors.js';

type CoreTable = Awaited<ReturnType<typeof createCoreTableService>>;

// The only writer of `paymentConnection` and `paymentChange`: the
// administrator's Stripe setup, non-secret facts only (the key and signing
// secret live in the secrets service). A save that switches account or
// disconnects takes a short lease (`changing`), which needs no open checkout,
// so a checkout can't start between the check and the change and no payment
// is in flight while the secrets are replaced. A key rotation takes no lease
// but is conditioned on `revision`, so it loses cleanly to a concurrent switch.

/** How long a change holds the lease before another save may take it over. */
export const LEASE_SECONDS = 2 * 60;
export const CHANGE_LIST_LIMIT = 10;

export interface PaymentConnectionRecord {
  status: PaymentConnectionStatus;
  mode: PaymentMode;
  accountId?: string;
  accountName?: string;
  keyLast4?: string;
  webhookEndpointId?: string;
  webhookUrl?: string;
  webhookEvents?: string[];
  latestCheckoutExpiresAt?: string;
  leaseUntil?: string;
  previousStatus?: PaymentConnectionStatus;
  revision: number;
  changedBy?: string;
  changedByName?: string;
  changedAt?: string;
}

export interface PaymentChangeRecord {
  changeId: string;
  kind: PaymentChangeKind;
  byUserId: string;
  byName: string;
  at: string;
  mode?: PaymentMode;
  accountId?: string;
  keyLast4?: string;
  step?: PaymentChangeStep;
}

/** Checkouts are open until `until`, so the account can't be changed yet. */
export class OpenCheckoutError extends Error {
  constructor(readonly until: string) {
    super(`Checkouts are open until ${until}`);
    this.name = 'OpenCheckoutError';
  }
}

/** Another change holds the lease, or this one lost a race on `revision`. */
export class ChangeInProgressError extends Error {
  constructor(message = 'Another change is in progress') {
    super(message);
    this.name = 'ChangeInProgressError';
  }
}

export interface Actor {
  userId: string;
  name: string;
}

// A patch returns nothing unless asked for the record as written.
const ALL_NEW = { response: 'all_new' } as const;

const plusSeconds = (iso: string, seconds: number) =>
  new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

export const getConnection = async (
  coreTable: CoreTable,
): Promise<PaymentConnectionRecord | undefined> =>
  ((await coreTable.entities.paymentConnection.get({}).go()).data ??
    undefined) as PaymentConnectionRecord | undefined;

// Runs a conditional write, turning a failed condition into
// ChangeInProgressError: the record changed since it was read.
const guarded = async <T>(write: () => Promise<T>): Promise<T> => {
  try {
    return await write();
  } catch (error) {
    if (isConditionalCheckFailed(error)) throw new ChangeInProgressError();
    throw error;
  }
};

/**
 * Takes the change lease and returns the record as it now stands. The
 * connection must be `active` with no open checkout, `disconnected`, or
 * `changing` with a lease that has passed; the first connection creates the
 * record. Throws `OpenCheckoutError` while a checkout may be open and
 * `ChangeInProgressError` while a live lease is held or the record moved.
 */
export const beginChange = async ({
  coreTable,
  now,
  mode,
  by,
}: {
  coreTable: CoreTable;
  now: string;
  /** The mode of the key being saved; recorded for a first connection. */
  mode: PaymentMode;
  by: Actor;
}): Promise<PaymentConnectionRecord> => {
  const leaseUntil = plusSeconds(now, LEASE_SECONDS);
  const entity = coreTable.entities.paymentConnection;
  const current = await getConnection(coreTable);

  if (!current) {
    return guarded(async () => {
      const { data } = await entity
        .create({
          status: 'changing',
          mode,
          previousStatus: 'disconnected',
          leaseUntil,
          revision: 1,
          changedBy: by.userId,
          changedByName: by.name,
          changedAt: now,
        })
        .go();
      return data as PaymentConnectionRecord;
    });
  }

  const { revision } = current;
  if (current.status === 'changing') {
    if (current.leaseUntil && current.leaseUntil > now) {
      throw new ChangeInProgressError();
    }
    // A crashed change: take the lease over, keeping the status it began from.
    return guarded(
      async () =>
        (
          await entity
            .patch({})
            .set({
              leaseUntil,
              revision: revision + 1,
              changedBy: by.userId,
              changedByName: by.name,
              changedAt: now,
            })
            .where(
              (attr, op) =>
                `${op.eq(attr.status, 'changing')} AND ${op.eq(attr.revision, revision)}`,
            )
            .go(ALL_NEW)
        ).data as PaymentConnectionRecord,
    );
  }

  const latest = current.latestCheckoutExpiresAt;
  if (current.status === 'active' && latest !== undefined && latest > now) {
    throw new OpenCheckoutError(latest);
  }
  try {
    const { data } = await entity
      .patch({})
      .set({
        status: 'changing',
        previousStatus: current.status,
        leaseUntil,
        revision: revision + 1,
        changedBy: by.userId,
        changedByName: by.name,
        changedAt: now,
      })
      .where((attr, op) => {
        const same = `${op.eq(attr.status, current.status)} AND ${op.eq(attr.revision, revision)}`;
        if (current.status !== 'active') return same;
        // A checkout that started since the read raised the expiry without
        // moving `revision`, so the expiry is checked too.
        return latest === undefined
          ? `${same} AND ${op.notExists(attr.latestCheckoutExpiresAt)}`
          : `${same} AND ${op.eq(attr.latestCheckoutExpiresAt, latest)}`;
      })
      .go(ALL_NEW);
    return data as PaymentConnectionRecord;
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    // Lost to a checkout or another save: say which.
    const now2 = await getConnection(coreTable);
    if (
      now2?.status === 'active' &&
      now2.latestCheckoutExpiresAt &&
      now2.latestCheckoutExpiresAt > now
    ) {
      throw new OpenCheckoutError(now2.latestCheckoutExpiresAt);
    }
    throw new ChangeInProgressError();
  }
};

export interface ConnectionFacts {
  mode: PaymentMode;
  accountId: string;
  accountName: string;
  keyLast4: string;
  webhookEndpointId: string;
  webhookUrl: string;
  webhookEvents: string[];
}

/** Writes the account facts and makes the record `active`, ending the lease. */
export const completeConnection = async ({
  coreTable,
  connection,
  facts,
  by,
  now,
}: {
  coreTable: CoreTable;
  /** The record as `beginChange` returned it. */
  connection: Pick<PaymentConnectionRecord, 'revision'>;
  facts: ConnectionFacts;
  by: Actor;
  now: string;
}): Promise<PaymentConnectionRecord> =>
  guarded(
    async () =>
      (
        await coreTable.entities.paymentConnection
          .patch({})
          .set({
            ...facts,
            keyLast4: facts.keyLast4.slice(-4),
            status: 'active',
            revision: connection.revision + 1,
            changedBy: by.userId,
            changedByName: by.name,
            changedAt: now,
          })
          .remove(['leaseUntil', 'previousStatus'])
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'changing')} AND ${op.eq(attr.revision, connection.revision)}`,
          )
          .go(ALL_NEW)
      ).data as PaymentConnectionRecord,
  );

/**
 * Replaces the stored key's last four characters after a rotation for the same
 * account. Conditioned on `revision` and `active`, so it loses to a switch.
 */
export const rotateKey = async ({
  coreTable,
  connection,
  keyLast4,
  by,
  now,
}: {
  coreTable: CoreTable;
  connection: Pick<PaymentConnectionRecord, 'revision'>;
  keyLast4: string;
  by: Actor;
  now: string;
}): Promise<PaymentConnectionRecord> =>
  guarded(
    async () =>
      (
        await coreTable.entities.paymentConnection
          .patch({})
          .set({
            keyLast4: keyLast4.slice(-4),
            revision: connection.revision + 1,
            changedBy: by.userId,
            changedByName: by.name,
            changedAt: now,
          })
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'active')} AND ${op.eq(attr.revision, connection.revision)}`,
          )
          .go(ALL_NEW)
      ).data as PaymentConnectionRecord,
  );

/**
 * Records the events the existing endpoint now sends, after it was updated at
 * Stripe. Conditioned on `revision` and `active`, so it loses to a switch.
 */
export const setWebhookEvents = async ({
  coreTable,
  connection,
  webhookEvents,
  by,
  now,
}: {
  coreTable: CoreTable;
  connection: Pick<PaymentConnectionRecord, 'revision'>;
  webhookEvents: string[];
  by: Actor;
  now: string;
}): Promise<PaymentConnectionRecord> =>
  guarded(
    async () =>
      (
        await coreTable.entities.paymentConnection
          .patch({})
          .set({
            webhookEvents,
            revision: connection.revision + 1,
            changedBy: by.userId,
            changedByName: by.name,
            changedAt: now,
          })
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'active')} AND ${op.eq(attr.revision, connection.revision)}`,
          )
          .go(ALL_NEW)
      ).data as PaymentConnectionRecord,
  );

/** Marks the record `disconnected`, clearing the account facts and the lease. */
export const completeDisconnect = async ({
  coreTable,
  connection,
  by,
  now,
}: {
  coreTable: CoreTable;
  connection: Pick<PaymentConnectionRecord, 'revision'>;
  by: Actor;
  now: string;
}): Promise<PaymentConnectionRecord> =>
  guarded(
    async () =>
      (
        await coreTable.entities.paymentConnection
          .patch({})
          .set({
            status: 'disconnected',
            revision: connection.revision + 1,
            changedBy: by.userId,
            changedByName: by.name,
            changedAt: now,
          })
          .remove([
            'accountId',
            'accountName',
            'keyLast4',
            'webhookEndpointId',
            'webhookUrl',
            'leaseUntil',
            'previousStatus',
          ])
          .where(
            (attr, op) =>
              `${op.eq(attr.status, 'changing')} AND ${op.eq(attr.revision, connection.revision)}`,
          )
          .go(ALL_NEW)
      ).data as PaymentConnectionRecord,
  );

/**
 * Ends a lease after a failure, putting the status back to what the change
 * began from. A record that has moved on (the lease was taken over) is left
 * alone.
 */
export const abandonChange = async ({
  coreTable,
  connection,
}: {
  coreTable: CoreTable;
  connection: Pick<PaymentConnectionRecord, 'revision' | 'previousStatus'>;
}): Promise<void> => {
  try {
    await coreTable.entities.paymentConnection
      .patch({})
      .set({
        status: connection.previousStatus ?? 'disconnected',
        revision: connection.revision + 1,
      })
      .remove(['leaseUntil', 'previousStatus'])
      .where(
        (attr, op) =>
          `${op.eq(attr.status, 'changing')} AND ${op.eq(attr.revision, connection.revision)}`,
      )
      .go();
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
  }
};

/** Appends an audit row. Never stores more than four characters of a key. */
export const recordChange = async (
  coreTable: CoreTable,
  change: Omit<PaymentChangeRecord, 'changeId'>,
): Promise<void> => {
  await coreTable.entities.paymentChange
    .create({
      ...change,
      keyLast4: change.keyLast4?.slice(-4),
      changeId: uuidv7(),
    })
    .go();
};

/** The newest audit rows, newest first. */
export const listChanges = async (
  coreTable: CoreTable,
  limit = CHANGE_LIST_LIMIT,
): Promise<PaymentChangeRecord[]> =>
  (
    await coreTable.entities.paymentChange.query
      .primary({})
      .go({ order: 'desc', limit })
  ).data as PaymentChangeRecord[];
