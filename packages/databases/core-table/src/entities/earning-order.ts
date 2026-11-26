/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { PAYMENT_MODES } from './payment-connection.js';

const figure = {
  type: 'number',
  required: true,
  readOnly: true,
  validate: (value: number) => Number.isInteger(value) && value >= 0,
} as const;

// One per sale: the snapshot refunds are computed from, and the counter that
// serialises them. Created with the sale's entries and changed only by
// `recordRefund`, both in ../helpers/earning.ts.
export const createEarningOrderEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'earningOrder',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        orderId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        courseId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        currency: {
          type: 'string',
          required: true,
          readOnly: true,
        },
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
        grossMinor: figure,
        discountMinor: figure,
        paidMinor: figure,
        // The total fee: round-half-up of paidMinor x feeBasisPoints / 10000.
        feeMinor: figure,
        // The fee in effect when the sale was recorded.
        feeBasisPoints: figure,
        // The split recipients, sorted ascending, as when the sale was
        // recorded.
        instructorIds: {
          type: 'list',
          items: {
            type: 'string',
          },
          required: true,
          readOnly: true,
        },
        // The refunded total already in the ledger: from 0 to `paidMinor`
        // (a rule ElectroDB can't see across attributes; `recordRefund`
        // caps it and an invariant checks it). It rises with a refund and
        // returns to 0 when `recordRefundReversal` takes the refund back.
        refundedMinor: {
          type: 'number',
          required: true,
          validate: (value: number) => Number.isInteger(value) && value >= 0,
        },
        // When `recordRefundReversal` last took a refund back, set even when
        // the ledger held none yet. A refund dated at or before it is an old
        // notice of the refund that failed, and `recordRefund` leaves it out.
        reversedAt: {
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
            composite: ['orderId'],
          },
          sk: {
            field: 'sk',
            composite: [],
            template: 'earning',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
