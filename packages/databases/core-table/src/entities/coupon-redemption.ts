/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One student's use of a coupon: the key is the rule, one per student per
// code. `reserved` while the checkout can still be paid, then `redeemed`; a
// released reservation is deleted. Only the builders in
// ../helpers/coupon-redemption.ts write it, with the coupon's redeemedCount.
export const createCouponRedemptionEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'couponRedemption',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        courseId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        code: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The student.
        userId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        orderId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        status: {
          type: ['reserved', 'redeemed'] as const,
          required: true,
        },
        // Required while reserved, removed once redeemed.
        reservedUntil: {
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
        // A code's redemptions; one student's by sk.
        primary: {
          pk: {
            field: 'pk',
            composite: ['courseId', 'code'],
          },
          sk: {
            field: 'sk',
            composite: ['userId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
