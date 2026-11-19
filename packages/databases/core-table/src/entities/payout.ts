/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { PAYMENT_MODES } from './payment-connection.js';

export const PAYOUT_STATUSES = [
  'collecting',
  'pending',
  'sent',
  'failed',
  'releasing',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

const count = {
  type: 'number',
  required: true,
  validate: (value: number) => Number.isInteger(value),
} as const;

// One transfer of an instructor's released earnings in one currency from one
// payment account. Written only by the helpers in ../helpers/payout.ts.
export const createPayoutEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'payout',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        instructorId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // A UUIDv7; also Stripe's idempotency key and the transfer's group.
        payoutId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The payment account it is paid from.
        accountId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        mode: {
          type: PAYMENT_MODES,
          required: true,
          readOnly: true,
        },
        currency: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        status: {
          type: PAYOUT_STATUSES,
          required: true,
        },
        // The net sum of the entries attached so far; kept as the amount
        // attempted once failed.
        amountMinor: count,
        entryCount: count,
        // When a run last worked on the payout.
        attemptedAt: {
          type: 'string',
          required: true,
        },
        // The destination, copied from the payout account.
        connectedAccountId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        transferId: {
          type: 'string',
        },
        failureReason: {
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
        settledAt: {
          type: 'string',
        },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            composite: ['instructorId'],
          },
          // An instructor's payouts in time order.
          sk: {
            field: 'sk',
            composite: ['createdAt', 'payoutId'],
            template: 'P#${createdAt}#${payoutId}',
            casing: 'none',
          },
        },
        // Recovery reads the unsettled payouts of every instructor.
        payoutsByStatus: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['status'],
            template: 'PAYOUT#${status}',
            casing: 'none',
          },
          sk: {
            field: 'gsi1sk',
            composite: ['payoutId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
