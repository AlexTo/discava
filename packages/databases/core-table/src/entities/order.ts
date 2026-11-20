/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';
import { PAYMENT_MODES } from './payment-connection.js';

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'expired',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Why a `refunded` order was refunded: an operator's refund (`requested`), a
// second payment for a course the student already has (`duplicate`), a course
// no longer published (`unavailable`), or a paid session whose student,
// course, amount or currency differ from the order's (`mismatch`).
export const ORDER_REFUND_REASONS = [
  'requested',
  'duplicate',
  'unavailable',
  'mismatch',
] as const;
export type OrderRefundReason = (typeof ORDER_REFUND_REASONS)[number];

// One checkout attempt by one student for one course. Written only by the
// helpers in ../helpers/order.ts.
export const createOrderEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'order',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // A UUIDv7, like courseId, so orders sort by creation.
        orderId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The student (Cognito `sub`).
        userId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        courseId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The Stripe account that takes the payment: the connection's account
        // when the checkout started.
        accountId: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The connection's mode when the checkout started. A test key and a
        // live key of one Stripe account share an `accountId`, so this is what
        // tells their orders apart.
        mode: {
          type: PAYMENT_MODES,
          required: true,
          readOnly: true,
        },
        // The title when the checkout started, shown to the payer.
        courseTitle: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        // The course price when the checkout started, and what Stripe is asked
        // to charge, both in the smallest currency unit. Equal for now.
        listAmount: {
          type: 'number',
          required: true,
          readOnly: true,
        },
        amount: {
          type: 'number',
          required: true,
          readOnly: true,
        },
        currency: {
          type: 'string',
          required: true,
          readOnly: true,
        },
        status: {
          type: ORDER_STATUSES,
          required: true,
        },
        // When the checkout lapses. A pending order past it counts as closed
        // even if its `expired` event never arrived.
        expiresAt: {
          type: 'string',
          required: true,
        },
        checkoutSessionId: {
          type: 'string',
        },
        checkoutUrl: {
          type: 'string',
        },
        // How a refund finds the order's payment.
        paymentIntentId: {
          type: 'string',
        },
        // When Stripe confirmed payment; also set on an order refunded
        // automatically, as the money was taken.
        paidAt: {
          type: 'string',
        },
        refundedAt: {
          type: 'string',
        },
        // The total refunded so far; never lowered.
        refundedAmount: {
          type: 'number',
        },
        refundReason: {
          type: ORDER_REFUND_REASONS,
        },
        // Set once, when a student's refund request was accepted and Stripe
        // was asked; never cleared, and absent on an operator's refund. Not a
        // status: the order stays `paid` until `charge.refunded` arrives.
        refundRequestedAt: {
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
          },
        },
        // A student's orders for a course. Shares gsi1 with enrolment's
        // byUser; the entity's own key prefix keeps a query here from ever
        // returning an enrolment.
        byStudentCourse: {
          index: 'gsi1pk-gsi1sk-index',
          pk: {
            field: 'gsi1pk',
            composite: ['userId'],
          },
          sk: {
            field: 'gsi1sk',
            composite: ['courseId', 'orderId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
