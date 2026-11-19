/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { PAYMENT_MODES } from './payment-connection.js';

export const PAYMENT_CHANGE_KINDS = [
  'connected',
  'replaced',
  'switched',
  'disconnected',
  'failed',
] as const;
export type PaymentChangeKind = (typeof PAYMENT_CHANGE_KINDS)[number];

// The step of a save that failed, on a `failed` row.
export const PAYMENT_CHANGE_STEPS = [
  'key',
  'account',
  'registration',
  'storage',
  'busy',
  'open-checkout',
] as const;
export type PaymentChangeStep = (typeof PAYMENT_CHANGE_STEPS)[number];

// An append-only audit row for each attempt to change the Stripe connection:
// who, when, which account and the last four characters of the key; never a
// value or Stripe's raw error text. Rows are never deleted. Written only by
// the helpers in ../helpers/payment-connection.ts.
export const createPaymentChangeEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'paymentChange',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // A UUIDv7, so rows sort by time.
        changeId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        kind: {
          type: PAYMENT_CHANGE_KINDS,
          required: true,
          readOnly: true,
        },
        byUserId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        byName: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        at: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        mode: {
          type: PAYMENT_MODES,
          readOnly: true,
        },
        accountId: {
          type: 'string',
          readOnly: true,
        },
        keyLast4: {
          type: 'string',
          readOnly: true,
        },
        step: {
          type: PAYMENT_CHANGE_STEPS,
          readOnly: true,
        },
        createdAt: {
          type: 'string',
          required: true,
          default: () => new Date().toISOString(),
          readOnly: true,
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
            composite: ['changeId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
