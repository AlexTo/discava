/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// DynamoDB has no unique constraint beyond the key, so a category's slug and
// its normalised name are each claimed by a record keyed on the value, created
// in the same transaction as the category with a "not exists" condition. A
// claim's `claim` is `slug#<slug>` or `name#<normalised name>`. Written only
// by categoryWrites.
export const createCategoryClaimEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'categoryClaim',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        claim: {
          type: 'string',
          required: true,
        },
        // The category that owns the claim.
        categoryId: {
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
            composite: [],
          },
          sk: {
            field: 'sk',
            composite: ['claim'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
