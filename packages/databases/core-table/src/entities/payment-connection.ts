/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

export const PAYMENT_CONNECTION_STATUSES = [
  'active',
  'changing',
  'disconnected',
] as const;
export type PaymentConnectionStatus =
  (typeof PAYMENT_CONNECTION_STATUSES)[number];

export const PAYMENT_MODES = ['test', 'live'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

// The administrator's Stripe setup: the non-secret facts only. The key and
// signing secret live in the secrets service and never in this record. A
// singleton under a constant key, absent until the first save. Written only by
// the helpers in ../helpers/payment-connection.ts.
export const createPaymentConnectionEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'paymentConnection',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // `changing` while a switch or disconnect holds the lease; checkout
        // and pricing treat it as unconnected.
        status: {
          type: PAYMENT_CONNECTION_STATUSES,
          required: true,
        },
        // From the key's prefix.
        mode: {
          type: PAYMENT_MODES,
          required: true,
        },
        accountId: {
          type: 'string',
        },
        accountName: {
          type: 'string',
        },
        // The last four characters of the key, for display.
        keyLast4: {
          type: 'string',
        },
        webhookEndpointId: {
          type: 'string',
        },
        webhookUrl: {
          type: 'string',
        },
        // The largest `expiresAt` of any order started under any connection.
        // Keeps its value through `disconnected`.
        latestCheckoutExpiresAt: {
          type: 'string',
        },
        // Set only while `changing`; a later save may take over once passed.
        leaseUntil: {
          type: 'string',
        },
        // The status a change started from, so a failed change can put it
        // back. Set only while `changing`.
        previousStatus: {
          type: PAYMENT_CONNECTION_STATUSES,
        },
        // Incremented by every administrator write (not by a checkout raising
        // `latestCheckoutExpiresAt`), so racing saves lose cleanly.
        revision: {
          type: 'number',
          required: true,
        },
        changedBy: {
          type: 'string',
        },
        changedByName: {
          type: 'string',
        },
        changedAt: {
          type: 'string',
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
        },
        updatedAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          watch: '*',
          set: () => new Date().toISOString(),
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            composite: [],
          },
          sk: {
            field: 'sk',
            composite: [],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
