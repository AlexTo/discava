/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A discount code an instructor makes for one course. `redeemedCount` counts
// reserved plus redeemed redemptions and is written only by the builders in
// ../helpers/coupon-redemption.ts, together with the couponRedemption record.
export const createCouponEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'coupon',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // Normalised: upper case, 4 to 24 of A-Z, 0-9 and -.
        code: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        type: {
          type: ['percent', 'fixed'] as const,
          required: true,
          readOnly: true,
        },
        // percent: an integer 1 to 100; fixed: integer minor units above 0.
        value: {
          type: 'number',
          required: true,
          readOnly: true,
        },
        // The course's currency when created; required for fixed coupons.
        currency: {
          type: 'string',
          readOnly: true,
        },
        // The end of the chosen date, UTC.
        expiresAt: {
          type: 'string',
        },
        maxRedemptions: {
          type: 'number',
        },
        redeemedCount: {
          type: 'number',
          required: true,
          default: 0,
        },
        enabled: {
          type: 'boolean',
          required: true,
          default: true,
        },
        createdBy: {
          type: 'string',
          required: true,
          readOnly: true,
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
        // A course's coupons; one by its code.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId'],
          },
          sk: {
            field: 'sk',
            composite: ['code'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
