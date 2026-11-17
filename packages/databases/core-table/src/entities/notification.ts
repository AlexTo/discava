/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// One in-app notification for one user and event. Written only by
// core-table's notification helpers; the sort key (`<occurredAt>#<id>`) is
// the notification's position and public id.
export const createNotificationEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'notification',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
        },
        // ISO time of the event, from the producer (UTC, millisecond
        // precision, so strings sort by time).
        occurredAt: {
          type: 'string',
          required: true,
        },
        // First 16 hex characters of sha256(type + "\0" + dedupeKey).
        id: {
          type: 'string',
          required: true,
        },
        // A notification registry id, for example 'assignment.returned'.
        type: {
          type: 'string',
          required: true,
        },
        title: {
          type: 'string',
          required: true,
        },
        body: {
          type: 'string',
          required: true,
        },
        link: {
          type: 'map',
          required: true,
          properties: {
            portal: {
              type: ['student', 'instructor', 'admin'] as const,
              required: true,
            },
            path: {
              type: 'string',
              required: true,
              validate: /^\//,
            },
          },
        },
        // Set when marked read individually. A notification is also read
        // when its position is at or before the user's `readThrough`.
        readAt: {
          type: 'string',
        },
        // Email delivery, changed only by helpers/notification-email.ts.
        email: {
          type: 'map',
          required: true,
          default: () => ({ state: 'pending' }),
          properties: {
            state: {
              type: [
                'pending',
                'sending',
                'sent',
                'skipped',
                'failed',
                'unknown',
              ] as const,
              required: true,
            },
            reason: { type: 'string' },
            claimedAt: { type: 'string' },
            sentAt: { type: 'string' },
            messageId: { type: 'string' },
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
            composite: ['userId'],
          },
          sk: {
            field: 'sk',
            composite: ['occurredAt', 'id'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
