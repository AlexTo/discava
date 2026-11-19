/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  ConnectError,
  registerEndpoint,
  removeEndpoint,
  removeLeftoverEndpoints,
  verifyKey,
} from '@discava/common-server-utils/stripe/connect';
import {
  clearStripeSecrets,
  readStripeApiKey,
  writeStripeSecrets,
} from '@discava/common-server-utils/stripe/secrets-admin';
import {
  type Actor,
  abandonChange,
  beginChange,
  ChangeInProgressError,
  type CoreTable,
  completeConnection,
  completeDisconnect,
  getConnection,
  listChanges,
  OpenCheckoutError,
  type PaymentChangeRecord,
  type PaymentConnectionRecord,
  recordChange,
  rotateKey,
} from '@discava/core-table';
import { TRPCError } from '@trpc/server';
import { adminProcedure } from '../init.js';
import {
  ConnectPaymentInputSchema,
  ConnectPaymentOutputSchema,
  DisconnectPaymentOutputSchema,
  type IPaymentStatus,
  PaymentStatusOutputSchema,
} from '../schema/index.js';

// The administrator's Stripe connection (research R-14 to R-17). `status` is
// served by the shared admin router (table reads only). `connect` and
// `disconnect` are served by the dedicated `PaymentsConnect` function, the
// only one allowed to write the two Stripe secrets. Nothing here, in a
// response, an error or a log line, carries the key or the signing secret:
// the key arrives in `connect`'s input and goes nowhere but Stripe and the
// secrets service.

const MESSAGES = {
  noAddress: "The payment confirmation address isn't available",
  busy: 'Another change is in progress; try again in a minute',
  nothingConnected: 'Nothing is connected',
  storage: "Couldn't save the key; nothing was changed",
  oldRegistration:
    "Couldn't remove the old confirmation address from Stripe; remove it in the Stripe dashboard",
} as const;

const webhookUrl = () => process.env.STRIPE_WEBHOOK_URL || undefined;
const stage = () => process.env.STRIPE_ENDPOINT_STAGE || 'local';

const displayName = async (coreTable: CoreTable, userId: string) => {
  const { data } = await coreTable.entities.user.get({ userId }).go();
  const name = [data?.givenName, data?.familyName].filter(Boolean).join(' ');
  return name || 'An administrator';
};

const toChange = (
  row: PaymentChangeRecord,
): IPaymentStatus['changes'][number] => ({
  kind: row.kind,
  byName: row.byName,
  at: row.at,
  ...(row.mode !== undefined && { mode: row.mode }),
  ...(row.keyLast4 !== undefined && { keyLast4: row.keyLast4 }),
  ...(row.step !== undefined && { step: row.step }),
});

// Built field by field from the record, so nothing else on it can leak.
const statusOf = async (
  coreTable: CoreTable,
  connection: PaymentConnectionRecord | undefined,
  now: string,
): Promise<IPaymentStatus> => {
  const changes = (await listChanges(coreTable)).map(toChange);
  if (!connection) return { state: 'not-connected', changes };
  const shown = connection.status !== 'disconnected';
  const current = webhookUrl();
  return {
    state: connection.status,
    ...(shown && { mode: connection.mode }),
    ...(shown &&
      connection.accountName !== undefined && {
        accountName: connection.accountName,
      }),
    ...(shown &&
      connection.keyLast4 !== undefined && { keyLast4: connection.keyLast4 }),
    ...(connection.changedByName !== undefined && {
      changedByName: connection.changedByName,
    }),
    ...(connection.changedAt !== undefined && {
      changedAt: connection.changedAt,
    }),
    ...(connection.latestCheckoutExpiresAt !== undefined &&
      connection.latestCheckoutExpiresAt > now && {
        openCheckoutsUntil: connection.latestCheckoutExpiresAt,
      }),
    ...(connection.status === 'active' &&
      current !== undefined && {
        addressChanged: connection.webhookUrl !== current,
      }),
    changes,
  };
};

export const paymentStatus = adminProcedure
  .output(PaymentStatusOutputSchema)
  .query(async ({ ctx }) =>
    statusOf(
      ctx.coreTable,
      await getConnection(ctx.coreTable),
      new Date().toISOString(),
    ),
  );

// Maps what a save can fail with to a tRPC error with a fixed message.
const toTrpcError = (error: unknown): TRPCError => {
  if (error instanceof TRPCError) return error;
  if (error instanceof ConnectError) {
    return new TRPCError({ code: error.code, message: error.message });
  }
  if (error instanceof OpenCheckoutError) {
    return new TRPCError({
      code: 'CONFLICT',
      message: `Checkouts are open until ${error.until}; try again after`,
    });
  }
  if (error instanceof ChangeInProgressError) {
    return new TRPCError({ code: 'CONFLICT', message: MESSAGES.busy });
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: MESSAGES.storage,
  });
};

const failedStep = (error: unknown) =>
  error instanceof ConnectError
    ? error.step
    : error instanceof OpenCheckoutError
      ? ('open-checkout' as const)
      : error instanceof ChangeInProgressError
        ? ('busy' as const)
        : ('storage' as const);

// Appends the `failed` audit row, itself never allowed to hide the real error.
const recordFailure = async (
  coreTable: CoreTable,
  by: Actor,
  error: unknown,
  now: string,
  details: {
    mode?: 'test' | 'live';
    accountId?: string;
    keyLast4?: string;
  } = {},
) => {
  try {
    await recordChange(coreTable, {
      kind: 'failed',
      byUserId: by.userId,
      byName: by.name,
      at: now,
      step: failedStep(error),
      ...details,
    });
  } catch {
    // The audit trail is best effort here; the caller reports the failure.
  }
};

export const connectPayment = adminProcedure
  .input(ConnectPaymentInputSchema)
  .output(ConnectPaymentOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { coreTable } = ctx;
    const { secretKey } = input;
    const now = new Date().toISOString();
    const by: Actor = {
      userId: ctx.user.sub,
      name: await displayName(coreTable, ctx.user.sub),
    };
    let known: {
      mode?: 'test' | 'live';
      accountId?: string;
      keyLast4?: string;
    } = {};

    try {
      const verified = await verifyKey(secretKey);
      known = {
        mode: verified.mode,
        accountId: verified.accountId,
        keyLast4: verified.keyLast4,
      };
      const url = webhookUrl();
      if (!url) {
        throw new ConnectError(
          MESSAGES.noAddress,
          'INTERNAL_SERVER_ERROR',
          'registration',
        );
      }

      const current = await getConnection(coreTable);
      const sameAccount =
        current?.status === 'active' &&
        current.accountId === verified.accountId &&
        current.mode === verified.mode;

      // The same account with the address unchanged is a rotation: the
      // registration and signing secret stay valid, so only the key changes.
      // The record moves first, conditioned on its revision, so a rotation
      // that lost to a switch writes no secret.
      if (current && sameAccount && current.webhookUrl === url) {
        await rotateKey({
          coreTable,
          connection: current,
          keyLast4: verified.keyLast4,
          by,
          now,
        });
        await writeStripeSecrets({ apiKey: secretKey });
        await recordChange(coreTable, {
          kind: 'replaced',
          byUserId: by.userId,
          byName: by.name,
          at: now,
          mode: verified.mode,
          accountId: verified.accountId,
          keyLast4: verified.keyLast4,
        });
        return statusOf(coreTable, await getConnection(coreTable), now);
      }

      // First connection, another account, another mode, or a new address.
      const leased = await beginChange({
        coreTable,
        now,
        mode: verified.mode,
        by,
      });
      let registeredId: string | undefined;
      let oldKey: string | undefined;
      try {
        // Read before the new key is saved, to remove the old registration.
        if (current?.status === 'active') {
          oldKey = await readStripeApiKey();
        }
        await removeLeftoverEndpoints({ secretKey, url, stage: stage() });
        const registration = await registerEndpoint({
          secretKey,
          url,
          stage: stage(),
        });
        registeredId = registration.id;
        await writeStripeSecrets({
          webhookSecret: registration.secret,
          apiKey: secretKey,
        });
        await completeConnection({
          coreTable,
          connection: leased,
          facts: {
            mode: verified.mode,
            accountId: verified.accountId,
            accountName: verified.accountName,
            keyLast4: verified.keyLast4,
            webhookEndpointId: registration.id,
            webhookUrl: url,
          },
          by,
          now,
        });
      } catch (error) {
        if (registeredId) {
          await removeEndpoint({ secretKey, endpointId: registeredId });
        }
        await abandonChange({ coreTable, connection: leased });
        throw error;
      }

      // The old registration goes with the old key; best effort, shown as a
      // warning, and never undoing the change.
      let warning: string | undefined;
      if (current?.status === 'active' && current.webhookEndpointId) {
        const removed =
          oldKey !== undefined &&
          (await removeEndpoint({
            secretKey: oldKey,
            endpointId: current.webhookEndpointId,
          }));
        if (!removed) warning = MESSAGES.oldRegistration;
      }

      await recordChange(coreTable, {
        kind:
          current?.status !== 'active'
            ? 'connected'
            : sameAccount
              ? 'replaced'
              : 'switched',
        byUserId: by.userId,
        byName: by.name,
        at: now,
        mode: verified.mode,
        accountId: verified.accountId,
        keyLast4: verified.keyLast4,
      });
      return {
        ...(await statusOf(coreTable, await getConnection(coreTable), now)),
        ...(warning && { warning }),
      };
    } catch (error) {
      await recordFailure(coreTable, by, error, now, known);
      throw toTrpcError(error);
    }
  });

export const disconnectPayment = adminProcedure
  .output(DisconnectPaymentOutputSchema)
  .mutation(async ({ ctx }) => {
    const { coreTable } = ctx;
    const now = new Date().toISOString();
    const by: Actor = {
      userId: ctx.user.sub,
      name: await displayName(coreTable, ctx.user.sub),
    };
    const current = await getConnection(coreTable);
    if (!current || current.status === 'disconnected') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: MESSAGES.nothingConnected,
      });
    }
    const known = {
      mode: current.mode,
      ...(current.accountId !== undefined && { accountId: current.accountId }),
      ...(current.keyLast4 !== undefined && { keyLast4: current.keyLast4 }),
    };

    try {
      const leased = await beginChange({
        coreTable,
        now,
        mode: current.mode,
        by,
      });
      let warning: string | undefined;
      try {
        const oldKey = await readStripeApiKey();
        if (current.webhookEndpointId) {
          const removed =
            oldKey !== undefined &&
            (await removeEndpoint({
              secretKey: oldKey,
              endpointId: current.webhookEndpointId,
            }));
          if (!removed) warning = MESSAGES.oldRegistration;
        }
        await clearStripeSecrets();
        await completeDisconnect({ coreTable, connection: leased, by, now });
      } catch (error) {
        await abandonChange({ coreTable, connection: leased });
        throw error;
      }
      await recordChange(coreTable, {
        kind: 'disconnected',
        byUserId: by.userId,
        byName: by.name,
        at: now,
        ...known,
      });
      return {
        ...(await statusOf(coreTable, await getConnection(coreTable), now)),
        ...(warning && { warning }),
      };
    } catch (error) {
      await recordFailure(coreTable, by, error, now, known);
      throw toTrpcError(error);
    }
  });
