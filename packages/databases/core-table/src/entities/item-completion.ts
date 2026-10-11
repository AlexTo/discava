/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Entity } from 'electrodb';
import { getDynamoDBClient, resolveTableName } from '../client.js';

// A student has completed one content item. Written only by core-api, at most
// once per student and item (created only if it doesn't exist), and never
// removed: whether it still counts is decided from the current curriculum.
// Keyed by user so a student's completions in a course are one query; the
// progress recalculation reads them to work out lesson and course progress.
export const createItemCompletionEntity = async () =>
  new Entity(
    {
      model: {
        entity: 'itemCompletion',
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
        // Not part of the key; kept so a record can be traced back to its
        // place in the curriculum without a scan.
        moduleId: {
          type: 'string',
          required: true,
        },
        completedAt: {
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
