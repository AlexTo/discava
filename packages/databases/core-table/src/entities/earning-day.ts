/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One row per instructor, course, currency and UTC day with activity: the sum
// of that day's entries, kept by ADD inside the entry's transaction. Written
// only by the helpers in ../helpers/earning.ts.
export const createEarningDayEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'earningDay',
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
        currency: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // `YYYY-MM-DD` of the entries' `occurredAt`.
        day: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // Sums of the day's entries, in minor units. `feeMinor` is the net
        // fee (sale fees minus fees returned).
        salesCount: { type: 'number' },
        grossMinor: { type: 'number' },
        discountMinor: { type: 'number' },
        refundMinor: { type: 'number' },
        feeMinor: { type: 'number' },
        netMinor: { type: 'number' },
      },
      indexes: {
        primary: {
          pk: {
            field: 'pk',
            composite: ['instructorId'],
          },
          // A day range is one query.
          sk: {
            field: 'sk',
            composite: ['day', 'courseId', 'currency'],
            template: 'D#${day}#${courseId}#${currency}',
            casing: 'none',
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
