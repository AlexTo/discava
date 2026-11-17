/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// Where a student last got to in one video, so the player can resume there.
// Written only by core-api's saveVideoPosition, overwritten by each save, and
// never removed. Keyed like itemCompletion (by user, then the item's place) so
// reading it is a single get. It is not student activity or progress: nothing
// recalculates from it, and it doesn't stop an instructor deleting the item.
export const createVideoPositionEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'videoPosition',
        version: '1',
        service: 'CoreTable',
      },
      attributes: {
        userId: {
          type: 'string',
          required: true,
        },
        courseId: {
          type: 'string',
          required: true,
        },
        lessonId: {
          type: 'string',
          required: true,
        },
        contentItemId: {
          type: 'string',
          required: true,
        },
        // Not part of the key; copied from the item.
        moduleId: {
          type: 'string',
          required: true,
        },
        // Whole seconds, 0 (start over) to VIDEO_POSITION_MAX_SECONDS.
        positionSeconds: {
          type: 'number',
          required: true,
        },
        // The nonce of the manifest the student played; a position only
        // applies to that version of the video.
        versionId: {
          type: 'string',
          required: true,
        },
        savedAt: {
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
            composite: ['userId'],
          },
          sk: {
            field: 'sk',
            composite: ['courseId', 'lessonId', 'contentItemId'],
          },
        },
      },
    },
    { client: getDynamoDBClient(), table: await resolveTableName() },
  );
