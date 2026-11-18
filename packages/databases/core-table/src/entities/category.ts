/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A node of the catalogue taxonomy a course can be filed under. The whole
// taxonomy shares one partition (a fixed pk), so listing it is one query;
// it is small and read by every catalogue response. Never deleted: archiving
// hides it from new choices while courses keep pointing at it. Written only
// by categoryWrites, alongside its two categoryClaim records.
export const createCategoryEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'category',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // A UUIDv7: the stable identifier courses point to.
        categoryId: {
          type: 'string',
          required: true,
        },
        // 1 to 60 characters, unique ignoring case and surrounding or
        // repeated spaces.
        name: {
          type: 'string',
          required: true,
        },
        // Derived from the name at creation, unique, immutable and URL-safe
        // (a-z, 0-9, -).
        slug: {
          type: 'string',
          required: true,
        },
        status: {
          type: ['active', 'archived'] as const,
          required: true,
          default: 'active',
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
            composite: [],
          },
          sk: {
            field: 'sk',
            composite: ['categoryId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
