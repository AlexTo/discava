/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// DynamoDB has no unique constraint beyond the key, so an instructor's handle
// is claimed by a record keyed on it, created with a "not exists" condition in
// the same transaction as the profile (or the handle change). Written only by
// instructorProfileWrites.
export const createProfileHandleClaimEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'profileHandleClaim',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        handle: {
          type: 'string',
          required: true,
        },
        // The profile that owns the handle.
        instructorId: {
          type: 'string',
          required: true,
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
            composite: ['handle'],
          },
          sk: {
            field: 'sk',
            composite: ['handle'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
