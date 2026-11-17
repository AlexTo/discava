/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A user's notification counters, created with their first notification.
// Every write is conditioned on `version`, so a racing publish and mark-read
// can't lose an update to `unreadCount`.
export const createNotificationStateEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'notificationState',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
        },
        // Never negative.
        unreadCount: {
          type: 'number',
          required: true,
        },
        // The position at or before which every notification is read; absent
        // until the first mark-all, and only moves forward.
        readThrough: {
          type: 'string',
        },
        // 1 on creation, +1 on every write.
        version: {
          type: 'number',
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
            composite: ['userId'],
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
