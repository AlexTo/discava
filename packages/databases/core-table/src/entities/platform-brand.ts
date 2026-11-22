/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// The deployment's one brand, set by an administrator: name, colour and the
// keys of the logo, icon and share image in the public media bucket. A
// singleton under a constant key, absent until the first save, and absence
// means every part is the default. Written only by saveBrand in
// ../helpers/platform-brand.ts.
export const createPlatformBrandEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'platformBrand',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        // Absent: the default name.
        name: {
          type: 'string',
        },
        showNameBesideLogo: {
          type: 'boolean',
          required: true,
          default: true,
        },
        // `#rrggbb`; absent: the neutral theme.
        colour: {
          type: 'string',
        },
        logoKey: {
          type: 'string',
        },
        iconKey: {
          type: 'string',
        },
        shareImageKey: {
          type: 'string',
        },
        // 1 on create, +1 on every save; the condition of every update.
        revision: {
          type: 'number',
          required: true,
        },
        changedBy: {
          type: 'string',
          required: true,
        },
        changedByName: {
          type: 'string',
          required: true,
        },
        changedAt: {
          type: 'string',
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
            composite: [],
          },
          sk: {
            field: 'sk',
            composite: [],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
