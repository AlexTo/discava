/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { PAYMENT_MODES } from './payment-connection.js';

export const EARNING_ENTRY_KINDS = ['sale', 'refund'] as const;
export type EarningEntryKind = (typeof EARNING_ENTRY_KINDS)[number];

const integer = {
  type: 'number',
  required: true,
  readOnly: true,
  validate: (value: number) => Number.isInteger(value),
} as const;

/** The `bySettlement` partition of an entry no payout has taken. */
export const openSettlement = (instructorId: string) => `open#${instructorId}`;

/** The `bySettlement` partition of the entries a payout has taken. */
export const payoutSettlement = (payoutId: string) => `payout#${payoutId}`;

// One sale or one recorded refund of an order, for one instructor. Immutable
// except `payoutId`. Written only by the helpers in ../helpers/earning.ts, and
// `payoutId` only by ../helpers/payout.ts.
export const createEarningEntryEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'earningEntry',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        instructorId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        courseId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        orderId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The order's payment account.
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
        // `sale-<orderId>`, or `refund-<orderId>-<refundedTotal>`.
        entryId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        kind: {
          type: EARNING_ENTRY_KINDS,
          required: true,
          readOnly: true,
        },
        currency: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The instructor's share, in minor units. Gross and discount are 0 on
        // refund entries, the refund amount is 0 on sale entries, the fee is
        // zero or negative on refund entries and the net is signed.
        grossMinor: integer,
        discountMinor: integer,
        refundMinor: integer,
        feeMinor: integer,
        netMinor: integer,
        // The fee in effect when the sale was recorded.
        feeBasisPoints: integer,
        occurredAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        releaseAt: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The payout that took the entry; the only attribute that changes.
        payoutId: {
          type: 'string',
        },
        // Which `bySettlement` partition the entry is in: `open#<instructorId>`
        // until a payout takes it, `payout#<payoutId>` after. Follows
        // `payoutId`. A patch that clears `payoutId` has no instructor to hand,
        // so it passes `openSettlement(instructorId)` as the value.
        settlement: {
          type: 'string',
          watch: '*',
          set: (
            value: string | undefined,
            item: { instructorId?: string; payoutId?: string },
          ) => {
            if (item.payoutId) return payoutSettlement(item.payoutId);
            if (value) return value;
            return item.instructorId
              ? openSettlement(item.instructorId)
              : undefined;
          },
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
            composite: ['instructorId'],
          },
          // A course's lines in time order: one range query per course.
          sk: {
            field: 'sk',
            composite: ['courseId', 'occurredAt', 'entryId'],
            template: 'L#${courseId}#${occurredAt}#${entryId}',
            casing: 'none',
          },
        },
        // An instructor's open entries and a payout's entries, ordered by
        // release time. The key only ever changes value.
        bySettlement: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['settlement'],
          },
          sk: {
            field: 'gsi1sk',
            composite: ['releaseAt', 'entryId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
