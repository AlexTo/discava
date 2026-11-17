/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A user's email choice for one notification type, stored only where they
// changed it from the registry's default. Absent means the default.
export const createNotificationPreferenceEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'notificationPreference',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
        },
        // A registered type that isn't `required`.
        type: {
          type: 'string',
          required: true,
        },
        emailEnabled: {
          type: 'boolean',
          required: true,
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
            composite: ['type'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
