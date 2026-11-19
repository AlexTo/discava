/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { PAYMENT_MODES } from './payment-connection.js';

export const PAYOUT_ACCOUNT_STATUSES = [
  'in_progress',
  'active',
  'restricted',
] as const;
export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

// An instructor's Stripe Express account, one per payment account (the
// platform's Stripe account plus its mode). Written only by the helpers in
// ../helpers/payout.ts.
export const createPayoutAccountEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'payoutAccount',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // The instructor (Cognito `sub`).
        instructorId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The payment account the connected account was created under.
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
        connectedAccountId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // Refreshed from Stripe when the instructor looks and before a payout.
        status: {
          type: PAYOUT_ACCOUNT_STATUSES,
          required: true,
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
            composite: ['instructorId'],
          },
          sk: {
            field: 'sk',
            composite: ['accountId', 'mode'],
            template: 'account#${accountId}#${mode}',
          },
        },
        // The accounts of one payment account in one status: the daily run
        // lists the active ones. Shares gsi1 with other entities; the key
        // names its own attributes, so no other entity's key can equal it.
        byStatus: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['accountId', 'mode', 'status'],
          },
          sk: {
            field: 'gsi1sk',
            composite: ['instructorId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
